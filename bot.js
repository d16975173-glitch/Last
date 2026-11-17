// Мини-бот на long polling без зависимостей: /start присылает кнопку «Играть»
const call = (t, m, b) =>
  fetch(`https://api.telegram.org/bot${t}/${m}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b || {}),
  }).then((r) => r.json());

export async function startBot(token, url) {
  if (!token || !url) return console.warn('Бот не запущен: нужны BOT_TOKEN и WEBAPP_URL');
  await call(token, 'deleteWebhook');
  await call(token, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Играть', web_app: { url } },
  });
  await call(token, 'setMyCommands', { commands: [{ command: 'start', description: 'Играть' }] });
  console.log('Бот запущен');
  let offset = 0;
  for (;;) {
    try {
      const r = await call(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      for (const u of r.result || []) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m) continue;
        const priv = m.chat.type === 'private';
        await call(token, 'sendMessage', {
          chat_id: m.chat.id,
          text: priv
            ? '⛓️ Последнее слово\nНапечатай приговор раньше, чем упадёт лезвие.'
            : 'Игра открывается в личном чате с ботом. Напиши мне в личку и нажми «Играть».',
          reply_markup: priv ? { inline_keyboard: [[{ text: '▶ Играть', web_app: { url } }]] } : undefined,
        });
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
