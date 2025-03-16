// Twitter Engagement Automator - Background Script
importScripts('utils.js');

// Store settings in background script for easy access
let settings = DEFAULT_SETTINGS;

// Listen for installation
chrome.runtime.onInstalled.addListener(function() {
  console.log('Twitter Engagement Automator installed');
  
  // Initialize settings
  loadSettings().then(items => {
    settings = items;
    console.log('Settings loaded in background script:', settings);
  }).catch(error => {
    console.error('Error loading settings:', error);
  });
});

// Listen for settings changes
chrome.storage.onChanged.addListener(function(changes, namespace) {
  if (namespace === 'sync') {
    // Update our local copy of settings
    for (let key in changes) {
      settings[key] = changes[key].newValue;
    }
    console.log('Settings updated in background script:', settings);
  }
});

// Make API request (proxy to avoid CORS issues)
async function makeApiRequest(apiEndpoint, apiKey, requestBody) {
  console.log('Background script making API request to:', apiEndpoint);
  console.log('Using model:', requestBody.model);
  
  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    
    console.log('API response status:', response.status);
    
    if (!response.ok) {
      console.error(`API request failed with status ${response.status}`);
      return { 
        error: `API request failed with status ${response.status}`,
        status: response.status
      };
    }
    
    const data = await response.json();
    console.log('API response data:', data);
    
    // Log the raw content if available
    if (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
      const rawContent = data.choices[0].message.content;
      console.log('Raw content from Groq API:', rawContent);
    }
    
    return { data };
  } catch (error) {
    console.error('Error making API request:', error);
    return { error: error.message };
  }
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  console.log('Background script received message:', message);
  
  if (message.action === 'getSettings') {
    // Send settings to content script
    sendResponse({ settings: settings });
    return true;
  }
  
  if (message.action === 'updateSettings') {
    // Update settings
    settings = message.settings;
    // Save to storage
    saveSettings(settings).then(() => {
      console.log('Settings saved from background script');
      sendResponse({ success: true });
    }).catch(error => {
      console.error('Error saving settings:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (message.action === 'makeApiRequest') {
    // Handle API request from content script (to bypass CORS)
    makeApiRequest(message.apiEndpoint, message.apiKey, message.requestBody)
      .then(result => {
        console.log('API request completed, sending response back to content script');
        sendResponse(result);
      })
      .catch(error => {
        console.error('Error in makeApiRequest:', error);
        sendResponse({ error: error.message });
      });
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }
  
  return true;
}); 