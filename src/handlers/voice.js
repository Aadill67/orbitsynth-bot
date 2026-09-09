const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../../config');
const logger = require('../utils/logger');
const ai = require('../services/ai');
const { fetchWithTimeout } = require('../services/http');
const { getSessionKey } = require('../utils/session');
const { escapeHtml } = require('../utils/format');

const execFileAsync = promisify(execFile);
const TMP_DIR = path.join(os.tmpdir(), 'orbitsynth-voice');

module.exports = async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  const userId = ctx.from.id;
  const voice = ctx.message.voice;

  if (!voice) return;

  try {
    await ctx.sendChatAction('typing');
    await ctx.reply('🎤 Processing your voice message...');

    fs.mkdirSync(TMP_DIR, { recursive: true });

    const fileLink = await ctx.telegram.getFileLink(voice.file_id);
    const response = await fetchWithTimeout(fileLink.href, {}, 30_000);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const oggPath = path.join(TMP_DIR, `${userId}_${Date.now()}.ogg`);
    const wavPath = oggPath.replace('.ogg', '.wav');
    fs.writeFileSync(oggPath, buffer);

    let audioBuffer = buffer;
    let mimeType = voice.mime_type === 'audio/ogg' ? 'audio/ogg' : 'audio/wav';
    try {
      // Async ffmpeg — never block the event loop while transcoding.
      await execFileAsync('ffmpeg', [
        '-y', '-i', oggPath,
        '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wavPath,
      ], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
      audioBuffer = fs.readFileSync(wavPath);
      mimeType = 'audio/wav';
    } catch (e) {
      logger.warn('ffmpeg not available, sending raw audio', { error: e.message });
    }

    for (const f of [oggPath, wavPath]) {
      try { fs.unlinkSync(f); } catch {}
    }

    /* ── Transcribe: Whisper (OpenAI) → Gemini audio ─────────────────── */
    let transcription = null;
    if (config.openai.apiKey) {
      try {
        transcription = await transcribeWithWhisper(audioBuffer, mimeType);
      } catch (err) {
        logger.warn('Whisper failed, falling back to Gemini STT', { error: err.message });
      }
    }

    if (!transcription && ai.isEnabled) {
      transcription = await ai.transcribeAudio(
        audioBuffer.toString('base64'),
        mimeType
      );
    }

    if (!transcription) {
      return ctx.reply('❌ Transcription unavailable — admin needs to set OPENAI_API_KEY or GEMINI_API_KEY.');
    }

    await ctx.reply(`🎤 <b>Transcription:</b>\n${escapeHtml(transcription)}`, { parse_mode: 'HTML' });

    /* ── AI reply using the shared service (model fallback applies) ──── */
    if (ai.isEnabled) {
      await ctx.sendChatAction('typing');
      const reply = await ai.chat(
        sessionKey,
        transcription,
        'default',
        'The user just sent a voice message. Here is the transcription:\n\n' + transcription
      );
      await ctx.reply(reply);
    }

    logger.info('Voice processed', {
      userId, duration: voice.duration,
      transcribed: !!transcription, via: config.openai.apiKey ? 'whisper' : 'gemini',
    });
  } catch (err) {
    logger.error('Voice handler error', { userId, error: err.message });
    await ctx.reply('❌ Could not process voice message. Try again.').catch(() => {});
  }
};

async function transcribeWithWhisper(audioBuffer, mimeType) {
  const blob = new Blob([audioBuffer], { type: mimeType });
  const form = new FormData();
  form.append('file', blob, 'audio.' + (mimeType === 'audio/ogg' ? 'ogg' : 'wav'));
  form.append('model', 'whisper-1');

  const whisperRes = await fetchWithTimeout('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form,
  }, 60_000);

  if (!whisperRes.ok) {
    const errText = await whisperRes.text().catch(() => '');
    throw new Error(`Whisper returned ${whisperRes.status}: ${errText}`);
  }

  const whisperData = await whisperRes.json();
  if (!whisperData.text) throw new Error('Whisper returned empty text');
  return whisperData.text;
}