# Twitter Engagement Automator

A Chrome extension that automates engagement on Twitter by liking tweets, generating AI-powered comments, and following users.

## Features

- **Automatic Liking:** Like all visible tweets on your Twitter feed.
- **AI-Powered Comments:** Generate relevant comments using the Groq API (with various Llama 3.1 models).
- **Automatic Following:** Follow users who posted the visible tweets.
- **Customizable Settings:** Enable/disable individual features (liking, commenting, following).
- **Rate Limiting:** Respects Twitter's rate limits and includes random delays to appear natural.

## Installation

1. Download or clone this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable "Developer mode" in the top-right corner.
4. Click "Load unpacked" and select the directory containing the extension files.
5. The extension icon should appear in your browser toolbar.

## Usage

1. Click on the extension icon to open the popup.
2. Enter your Groq API key.
3. Toggle which actions you want to enable (like, comment, follow).
4. Toggle the "Automation Status" switch to activate the extension.
5. Navigate to Twitter and scroll through your feed - the extension will automatically engage with tweets.

## Configuration

- **API Key:** You need a Groq API key to use the comment generation feature.
- **Like Tweets:** Toggle to enable/disable automatic liking.
- **Comment on Tweets:** Toggle to enable/disable automatic commenting.
- **Follow Users:** Toggle to enable/disable automatic following.

## Technical Details

- The extension uses JavaScript to interact with Twitter's DOM.
- Comments are generated using the Groq API with various Llama 3.1 models (selectable in settings).
- API requests are queued and rate-limited to respect the 20 requests/minute limit.
- The extension tracks processed tweets and followed users to avoid duplicates.
- A mutation observer is used to detect new tweets as you scroll.
- The extension requires a valid Groq API connection to function. If the API connection fails, the automation will be disabled automatically.

## Privacy & Security

- Your API key is stored locally in Chrome's storage and is only used to make requests to the Groq API.
- The extension only runs on Twitter domains (twitter.com and x.com).
- No data is collected or sent to any third-party servers other than the Groq API for comment generation.

## Disclaimer

This extension is for educational purposes only. Using automation tools on Twitter may violate their Terms of Service. Use at your own risk.

## License

MIT # coolextension
