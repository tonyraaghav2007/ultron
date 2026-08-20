const fs = require('fs');
const https = require('https');

const prompt = encodeURIComponent("modern sleek coffee shop website landing page, glassmorphism, UI design, dribbble, high quality");
const url = `https://image.pollinations.ai/prompt/${prompt}?width=1920&height=1080&nologo=true`;

https.get(url, (res) => {
    const file = fs.createWriteStream("test_image.jpg");
    res.pipe(file);
    file.on('finish', () => {
        file.close();
        console.log("Image downloaded.");
    });
});
