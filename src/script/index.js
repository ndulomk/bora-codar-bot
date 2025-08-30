require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

async function postTweet() {
  try {
    const tweet = await client.v2.tweet('Damn meu primeiro tweet automatizado!');
    console.log('Tweet postado com sucesso:', tweet);
  } catch (error) {
    console.error('Erro ao postar tweet:', error);
  }
}

postTweet();