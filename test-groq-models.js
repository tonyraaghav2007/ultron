const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
(async () => {
    const models = await groq.models.list();
    console.log(models.data.map(m => m.id).filter(id => id.includes('vision')));
})();
