async function testMemory() {
    console.log("Adding memory...");
    const addRes = await fetch("http://localhost:3000/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            content: "User loves building AI assistants",
            category: "preference",
            tags: ["ai", "hobby"]
        })
    });
    const addData = await addRes.json();
    console.log("Add response:", addData);

    console.log("\nFetching all memories...");
    const getRes = await fetch("http://localhost:3000/api/memory");
    const getData = await getRes.json();
    console.log("All memories:", getData);

    console.log("\nSearching memories for 'AI'...");
    const searchRes = await fetch("http://localhost:3000/api/memory?q=AI");
    const searchData = await searchRes.json();
    console.log("Search results:", searchData);
}

testMemory();
