const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config');
const logger = require('../utils/logger');

const TMP_DIR = path.join(os.tmpdir(), 'orbitsynth-voice');

module.exports = async (ctx) => {
  const userId = ctx.from.id;
  const voice = ctx.message.voice;

  if (!voice) return;

  try {
    await ctx.sendChatAction('typing');
    await ctx.reply('🎤 Processing your voice message...');

    fs.mkdirSync(TMP_DIR, { recursive: true });

    const fileLink = await ctx.telegram.getFileLink(voice.file_id);
    const response = await fetch(fileLink.href);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const oggPath = path.join(TMP_DIR, `${userId}_${Date.now()}.ogg`);
    const wavPath = oggPath.replace('.ogg', '.wav');
    fs.writeFileSync(oggPath, buffer);

    let audioBuffer = buffer;
    try {
      execSync(`ffmpeg -y -i "${oggPath}" -acodec pcm_s16le -ar 16000 -ac 1 "${wavPath}"`, {
        stdio: 'pipe',
        timeout: 30000,
      });
      audioBuffer = fs.readFileSync(wavPath);
    } catch (e) {
      logger.warn('ffmpeg not available, sending raw ogg to Whisper', { error: e.message });
    }

    for (const f of [oggPath, wavPath]) {
      try { fs.unlinkSync(f); } catch {}
    }

    if (!config.openai.apiKey) {
      return ctx.reply('❌ Transcription unavailable — admin needs to set OPENAI_API_KEY');
    }

    const blob = new Blob([audioBuffer], {
      type: voice.mime_type === 'audio/ogg' ? 'audio/ogg' : 'audio/wav',
    });
    const form = new FormData();
    form.append('file', blob, 'audio.' + (voice.mime_type === 'audio/ogg' ? 'ogg' : 'wav'));
    form.append('model', 'whisper-1');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      body: form,
    });
    if (!whisperRes.ok) {
      const errText = await whisperRes.text().catch(() => '');
      throw new Error(`Whisper returned ${whisperRes.status}: ${errText}`);
    }

    const whisperData = await whisperRes.json();
    const transcription = whisperData.text;

    await ctx.reply(`🎤 <b>Transcription:</b>\n${transcription}`, { parse_mode: 'HTML' });

    if (config.ai.apiKey) {
      await ctx.sendChatAction('typing');

      const ai = new GoogleGenerativeAI(config.ai.apiKey);
      const model = ai.getGenerativeModel({ model: config.ai.model });
      const result = await model.generateContent(
        `The user sent a voice message. Here's the transcription:\n\n${transcription}\n\nProvide a helpful response.`
      );
      const reply = result.response.text();
      await ctx.reply(reply);
    }

    logger.info('Voice processed', { userId, duration: voice.duration, transcribed: !!transcription });
  } catch (err) {
    logger.error('Voice handler error', { userId, error: err.message });
    await ctx.reply('❌ Could not process voice message. Try again.');
  }
};
