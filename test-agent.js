
(async () => {
    try {
        const res = await fetch("http://127.0.0.1:3000/api/agent/step", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goal: "open whatsapp" })
        });
        const text = await res.text();
        console.log("STATUS:", res.status);
        console.log("BODY:", text);
    } catch (e) {
        console.error(e);
    }
})();
