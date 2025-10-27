module.exports = {
    database: {
        host: 'maglev.proxy.rlwy.net',
        port: 12663,
        user: 'root',
        password: 'SkJAJjOTcAsEXpljmzLvlWPqYXdWgRGl',
        database: 'inmobiliaria'
    },
    server: {
        port: 3001
    },
    rateLimits: {
        hour: 1,
        day: 10
    },
    messageDelay: 2,
    frontendMediaUrl: 'https://whatsbotadivisorfronted.onrender.com'
};