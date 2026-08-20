const fs = require('fs');
const path = require('path');

async function testFitnessLogic() {
    console.log("Testing Fitness Tools...");
    
    // Simulate API chat route request
    const reqBody = {
        message: "I just hit a new PR on bench press! 100kg for 3 reps",
        localTime: new Date().toLocaleTimeString(),
        interrupted: false,
        isSystem: false
    };

    const res = await fetch("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody)
    });
    
    const data = await res.json();
    console.log("AI Response (PR Log):", data.reply);
    
    const reqBody2 = {
        message: "Can you tell me what my bench press was and how much it went up?",
        localTime: new Date().toLocaleTimeString(),
        interrupted: false,
        isSystem: false
    };

    const res2 = await fetch("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody2)
    });
    
    const data2 = await res2.json();
    console.log("AI Response (History retrieval):", data2.reply);
}

testFitnessLogic().catch(console.error);
