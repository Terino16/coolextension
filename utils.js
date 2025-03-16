// Twitter Engagement Automator - Utility Functions

// Default settings
const DEFAULT_SETTINGS = {
  automationEnabled: false,
  likeEnabled: true,
  commentEnabled: true,
  followEnabled: true,
  debugMode: false,
  apiKey: '',
  apiEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
  model: 'llama-3.3-70b-versatile'
};

// Load settings from storage
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, function(items) {
      console.log('Loading settings:', items);
      resolve(items);
    });
  });
}

// Save settings to storage
function saveSettings(settings) {
  return new Promise((resolve) => {
    console.log('Saving settings:', settings);
    chrome.storage.sync.set(settings, function() {
      console.log('Settings saved successfully');
      resolve();
    });
  });
}

// Send message to background script
function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    try {
      console.log('Sending message to background script:', message);
      chrome.runtime.sendMessage(message, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error sending message to background:', chrome.runtime.lastError.message);
          reject(chrome.runtime.lastError);
        } else {
          console.log('Received response from background script:', response);
          resolve(response);
        }
      });
    } catch (error) {
      console.error('Error sending message:', error);
      reject(error);
    }
  });
}

// Send message to content script
function sendMessageToContent(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      console.log('Attempting to send message to content script in tab', tabId, 'Message:', message);
      
      // First check if the tab exists
      chrome.tabs.get(tabId, function(tab) {
        if (chrome.runtime.lastError) {
          console.error('Tab does not exist:', chrome.runtime.lastError.message);
          reject(new Error('Tab does not exist: ' + chrome.runtime.lastError.message));
          return;
        }
        
        console.log('Tab exists, URL:', tab.url);
        
        // Now try to send the message
        chrome.tabs.sendMessage(tabId, message, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Error sending message to content script:', chrome.runtime.lastError.message);
            console.log('This error often occurs when the content script is not loaded on the current page.');
            console.log('Current tab URL:', tab.url);
            console.log('Is this a Twitter/X page?', tab.url.includes('twitter.com') || tab.url.includes('x.com'));
            reject(chrome.runtime.lastError);
          } else {
            console.log('Received response from content script:', response);
            resolve(response);
          }
        });
      });
    } catch (error) {
      console.error('Exception in sendMessageToContent:', error);
      reject(error);
    }
  });
}

// Export functions
if (typeof module !== 'undefined') {
  module.exports = {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    sendMessageToBackground,
    sendMessageToContent
  };
} 