/** Maps AI service error status codes to friendly user-facing messages. */
function aiUserMessage(status, fallback = '⚠️ Something went wrong while generating a response. Please try again.') {
  if (status === 429) return '⏳ The AI is temporarily overloaded (quota exceeded). Please try again in a moment.';
  if (status === 401 || status === 403) return '🔑 AI authentication failed. Please contact the bot admin.';
  if (status === 404) return '🤖 The AI model is unavailable right now. The bot will auto-switch to a backup model — please try again.';
  if (status === 500 || status === 502) return '🔧 The AI service hit an internal error. Please try again.';
  if (status === 503 || status === 529) return '🔧 The AI service is currently overloaded. Please wait a few seconds and try again.';
  if (status === 0) return '🌐 Network error reaching the AI service. Please try again.';
  return fallback;
}

module.exports = { aiUserMessage };