
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const { getValidToken } = require('./gigachatTokenManager');

// Загрузка знаний из папки /knowledge
const gestaltTheory = fs.readFileSync(path.join(__dirname, 'knowledge', 'gestalt-theory.md'), 'utf-8');
const gestaltDialogExamples = fs.readFileSync(path.join(__dirname, 'knowledge', 'gestalt-dialog-examples.md'), 'utf-8');
const gestaltPrompts = fs.readFileSync(path.join(__dirname, 'knowledge', 'gestalt-prompts.txt'), 'utf-8');

// Жёсткий system prompt для гештальт-бота
const systemPrompt = `
Ты — исключительно AI-гештальт-терапевт.
Твоя задача — работать только в рамках гештальт-подхода:
- Не давай советов, не составляй планы, не обсуждай тайм-менеджмент, не используй коучинг, CBT, мотивацию, не давай рекомендации по изменению образа жизни.
- Не обсуждай баланс, эффективность, успех, карьеру, финансы, цели, продуктивность, саморазвитие, если только клиент сам явно не просит про это в терминах чувств.
- Всегда возвращай клиента к его чувствам, телесным ощущениям, переживаниям "здесь и сейчас", внутреннему диалогу, образам, фантазиям, снам, телесным реакциям.
- Используй техники гештальт-терапии: диалог с пустым стулом, работа с телом, осознанность, работа с фантазиями и снами, эксперименты, феноменологию.
- Если клиент просит совет или план, мягко возвращай его к исследованию своих чувств, ощущений, потребностей, осознанности.
- Не оценивай, не осуждай, не интерпретируй, не анализируй, не объясняй, не учи.
- Задавай только вопросы, помогающие клиенту осознать свои чувства, телесные реакции, желания, границы, внутренние конфликты.
- Не обсуждай темы, выходящие за рамки гештальт-подхода.

Примеры вопросов:
- Что ты сейчас чувствуешь?
- Где в теле ты ощущаешь это чувство?
- Какие образы или мысли приходят тебе в голову, когда ты об этом говоришь?
- Что происходит с твоим дыханием, когда ты вспоминаешь этот эпизод?
- Что бы ты хотел сказать себе прямо сейчас?
- Есть ли что-то, что ты хочешь сделать или сказать в этот момент?
- Какое ощущение вызывает у тебя этот разговор?
- Что мешает тебе выразить свои чувства полностью?
- Как ты относишься к этим чувствам?
- Что бы ты хотел получить от этой сессии?

Работай только в этом стиле, не выходи за рамки гештальт-терапии.

Вот выдержки из теории и примеры для твоей работы:

${gestaltTheory}

${gestaltDialogExamples}

${gestaltPrompts}
`;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GIGACHAT_URL = process.env.GIGACHAT_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';

if (!BOT_TOKEN) {
    console.error('Необходимо указать TELEGRAM_BOT_TOKEN в .env');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// In-memory история диалога для каждого пользователя
const userHistories = {};
const MAX_HISTORY_LENGTH = 10; // Максимум пар "вопрос-ответ" в истории

// /start
bot.start((ctx) => {
    ctx.reply('Здравствуйте! Я — AI Гештальт-терапевт. Просто напишите свой вопрос или поделитесь переживаниями.\n\n/help — список команд.');
});

// /help
bot.command('help', (ctx) => {
    ctx.reply(
        'Доступные команды:\n' +
        '/start — начать работу\n' +
        '/help — справка\n' +
        '/reset — сбросить историю диалога\n' +
        '/about — о боте\n' +
        '/stop — завершить сессию'
    );
});

// /reset
bot.command('reset', (ctx) => {
    userHistories[ctx.from.id] = [];
    ctx.reply('История диалога сброшена. Можем начать сначала.');
});

// /about
bot.command('about', (ctx) => {
    ctx.reply('Я — AI Гештальт-терапевт, созданный для поддержки и самопомощи. Использую техники гештальт-терапии и искусственный интеллект. Ваши сообщения не сохраняются и не передаются третьим лицам.');
});

// /stop
bot.command('stop', (ctx) => {
    userHistories[ctx.from.id] = [];
    ctx.reply('Сессия завершена. Если захотите продолжить — напишите мне снова. Берегите себя!');
});

// Основной обработчик сообщений
bot.on('message', async (ctx) => {
    // Игнорируем команды, чтобы не дублировать ответы
    if (ctx.message.text.startsWith('/')) return;

    const userId = ctx.from.id;
    const userInput = ctx.message.text;

    // Инициализация истории, если нет
    if (!userHistories[userId]) {
        userHistories[userId] = [];
    }

    // Добавляем новое сообщение пользователя в историю
    userHistories[userId].push({ role: 'user', content: userInput });

    // Обрезаем историю, если слишком длинная (оставляем последние MAX_HISTORY_LENGTH*2 сообщений)
    if (userHistories[userId].length > MAX_HISTORY_LENGTH * 2) {
        userHistories[userId] = userHistories[userId].slice(-MAX_HISTORY_LENGTH * 2);
    }

    // Формируем массив сообщений для LLM: system prompt + история
    const messages = [
        { role: 'system', content: systemPrompt },
        ...userHistories[userId]
    ];

    try {
        const token = await getValidToken();
        const requestBody = {
            model: 'GigaChat',
            messages: messages
        };

        const config = {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(GIGACHAT_URL, requestBody, config);
        const answer = response.data.choices[0].message.content.trim();

        // Добавляем ответ ассистента в историю
        userHistories[userId].push({ role: 'assistant', content: answer });

        // Обрезаем историю, если слишком длинная
        if (userHistories[userId].length > MAX_HISTORY_LENGTH * 2) {
            userHistories[userId] = userHistories[userId].slice(-MAX_HISTORY_LENGTH * 2);
        }

        await ctx.reply(answer);
    } catch (err) {
        console.error(err.response ? err.response.data : err);
        await ctx.reply('Упс... произошла ошибка!');
    }
});

bot.launch();
console.log('Gestalt LLM Telegram bot started with strict gestalt prompt, knowledge, history, and commands support');
