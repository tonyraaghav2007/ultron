const { Groq } = require('groq-sdk');

async function testGroq() {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const tools = [{
    type: "function",
    function: {
      name: "search_web",
      description: "Searches the internet for up-to-date information, news, current events, or facts. Use this whenever you don't know an answer or need real-time data.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to look up on the web."
          }
        },
        required: ["query"]
      }
    }
  }];

  const messages = [
    { role: "system", content: "You are an assistant. Search the web for Super Meteor 650 price." },
    { role: "user", content: "What is the price of super meteor 650 in punjab?" }
  ];

  console.log("Making request...");
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: "llama-3.3-70b-versatile",
      tools,
      tool_choice: "auto",
    });
    const messageObj = chatCompletion.choices[0].message;
    console.log("Response 1:", JSON.stringify(messageObj, null, 2));

    if (messageObj.tool_calls) {
      messages.push(messageObj);
      messages.push({
        role: "tool",
        tool_call_id: messageObj.tool_calls[0].id,
        name: messageObj.tool_calls[0].function.name,
        content: "The on-road price in Punjab is 4.7 lakh rupees."
      });

      console.log("Making second request...");
      const chatCompletion2 = await groq.chat.completions.create({
        messages,
        model: "llama-3.3-70b-versatile",
        tools,
        tool_choice: "auto",
      });
      console.log("Final Response:", JSON.stringify(chatCompletion2.choices[0].message, null, 2));
    }
  } catch (err) {
    console.error("SDK ERROR:", err);
  }
}

testGroq();
