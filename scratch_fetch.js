const url = 'https://news.google.com/rss/articles/CBMi6wFBVV95cUxNUW5BQ0pUZGpoNFdqYXZKVy1ac1lkSFJwTExOWHNQV3dSMkpEVFFtbGprcTVCaWJGbzI1RnE2UE5QbUxlb3JkWkhJTlRKbXVIazJYQVN0bEZjdzAzRXZScmRLVXgyTjVNVFJFUkpDcW9mbm1Qb1lFdW92cHhhbjdoZnlUc2d0OGh1bHBFTHAtOENlc0I4d0tOVXQtOE9heHpZTm55RUo3QzlfUmZ0UTJ5dFlLVHBKRHk3X0NKamJUQzR5SXhScU9KUklGY2hPblU1b1U0RU81S3VVa3lrcWNzaDFER3dEZG4teG53?oc=5';
async function run() {
  const res = await fetch(url);
  const text = await res.text();
  console.log(text.substring(0, 1000));
}
run();
