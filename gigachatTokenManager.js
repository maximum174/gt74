const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const GIGACHAT_AUTH_KEY = process.env.GIGACHAT_AUTH_KEY; // строка вида "Basic ..."

let accessToken = null;
let tokenExpiresAt = 0;

async function fetchGigaChatToken() {
    const url = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'RqUID': uuidv4(),
        'Authorization': GIGACHAT_AUTH_KEY
    };
    const data = new URLSearchParams({ scope: 'GIGACHAT_API_PERS' }).toString();

    try {
        const response = await axios.post(url, data, { headers });
        accessToken = response.data.access_token;
        // Токен живёт 30 минут, обновляем за 1 минуту до истечения
        tokenExpiresAt = Date.now() + (response.data.expires_in - 60) * 1000;
        return accessToken;
    } catch (error) {
        console.error("Ошибка при получении GigaChat Access Token:", error?.response?.data || error.message);
        throw new Error("Не удалось получить токен GigaChat");
    }
}

async function getValidToken() {
    if (!accessToken || Date.now() > tokenExpiresAt) {
        return await fetchGigaChatToken();
    }
    return accessToken;
}

module.exports = { getValidToken };
