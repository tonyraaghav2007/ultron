const google = require('googlethis');

async function testGoogleThis() {
  const news = await google.getTopNews('en', 'IN');
  console.log("Top news:", JSON.stringify(news.headline_stories.slice(0, 2), null, 2));
  
  const options = {
    page: 0, 
    safe: false, // Safe Search
    additional_params: {
      hl: 'en'
    }
  };
  
  const res = await google.search('technology news', options);
  console.log("Search news:", JSON.stringify(res.results.slice(0, 2), null, 2));
}

testGoogleThis();
