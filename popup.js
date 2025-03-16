document.addEventListener('DOMContentLoaded', function() {
  const automationToggle = document.getElementById('automation-toggle');
  const likeToggle = document.getElementById('like-toggle');
  const commentToggle = document.getElementById('comment-toggle');
  const followToggle = document.getElementById('follow-toggle');
  const debugToggle = document.getElementById('debug-toggle');
  const apiKeyInput = document.getElementById('api-key');
  const apiEndpointInput = document.getElementById('api-endpoint');
  const modelSelect = document.getElementById('model-select');
  const saveButton = document.getElementById('save-settings');
  const statusMessage = document.getElementById('status-message');
  
  // Default API endpoint
  const DEFAULT_API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  
  // Load saved settings
  loadSettings().then(items => {
    console.log('Settings loaded in popup:', items);
    automationToggle.checked = items.automationEnabled;
    likeToggle.checked = items.likeEnabled;
    commentToggle.checked = items.commentEnabled;
    followToggle.checked = items.followEnabled;
    debugToggle.checked = items.debugMode;
    apiKeyInput.value = items.apiKey;
    apiEndpointInput.value = items.apiEndpoint !== DEFAULT_API_ENDPOINT ? items.apiEndpoint : '';
    
    // Set the model dropdown
    if (items.model) {
      modelSelect.value = items.model;
    }
    
    updateStatusMessage(items.automationEnabled);
  }).catch(error => {
    console.error('Error loading settings:', error);
  });
  
  // Save settings
  saveButton.addEventListener('click', function() {
    const apiEndpoint = apiEndpointInput.value.trim() || DEFAULT_API_ENDPOINT;
    
    const settings = {
      automationEnabled: automationToggle.checked,
      likeEnabled: likeToggle.checked,
      commentEnabled: commentToggle.checked,
      followEnabled: followToggle.checked,
      debugMode: debugToggle.checked,
      apiKey: apiKeyInput.value,
      apiEndpoint: apiEndpoint,
      model: modelSelect.value
    };
    
    // Show warning if comments are enabled but no API key
    if (settings.commentEnabled && !settings.apiKey) {
      statusMessage.textContent = 'Error: Comments enabled but no API key provided. Please enter an API key or disable comments.';
      statusMessage.style.backgroundColor = '#f8d7da'; // Error color
      return;
    }
    
    // Test API connection if API key is provided and comments are enabled
    if (settings.apiKey && settings.commentEnabled) {
      statusMessage.textContent = 'Testing Groq API connection...';
      statusMessage.style.backgroundColor = '#fff3cd'; // Warning color
      
      testApiConnection(settings.apiKey, settings.apiEndpoint, settings.model)
        .then(isValid => {
          if (isValid) {
            statusMessage.textContent = 'Groq API connection successful! Settings saved.';
            statusMessage.style.backgroundColor = '#d4edda'; // Success color
            saveSettingsAndNotify(settings);
          } else {
            statusMessage.textContent = 'Groq API connection failed. Please check your API key and try again.';
            statusMessage.style.backgroundColor = '#f8d7da'; // Error color
            // Don't save settings if API test fails
            settings.automationEnabled = false;
            saveSettingsAndNotify(settings);
          }
          
          // Reset status message after 5 seconds
          setTimeout(() => {
            updateStatusMessage(settings.automationEnabled);
          }, 5000);
        });
    } else {
      // Save without testing API
      saveSettingsAndNotify(settings);
      
      // Show appropriate message based on settings
      if (settings.commentEnabled) {
        if (settings.apiKey) {
          statusMessage.textContent = 'Settings saved! Comments will use Groq API.';
          statusMessage.style.backgroundColor = '#d4edda'; // Success color
        } else {
          statusMessage.textContent = 'Settings saved! Comments disabled (no API key).';
          statusMessage.style.backgroundColor = '#fff3cd'; // Warning color
        }
      } else {
        statusMessage.textContent = 'Settings saved! Comments disabled.';
        statusMessage.style.backgroundColor = '#d4edda'; // Success color
      }
      
      setTimeout(() => {
        updateStatusMessage(settings.automationEnabled);
      }, 3000);
    }
  });
  
  // Function to test API connection
  async function testApiConnection(apiKey, apiEndpoint, model) {
    try {
      console.log('Testing Groq API connection to:', apiEndpoint);
      
      // Use the background script to make the API request (to avoid CORS)
      const requestBody = {
        model: model || 'llama-3.3-70b-versatile',
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant."
          },
          {
            role: "user",
            content: "Test connection"
          }
        ],
        max_tokens: 5,
        temperature: 0.7,
        top_p: 0.9
      };
      
      // Send the request through the background script
      const response = await sendMessageToBackground({
        action: 'makeApiRequest',
        apiEndpoint: apiEndpoint,
        apiKey: apiKey,
        requestBody: requestBody
      });
      
      console.log('API test response:', response);
      
      // Check if the response was successful
      if (response && !response.error && response.data) {
        return true;
      } else {
        console.error('API test failed:', response ? response.error : 'No response');
        return false;
      }
    } catch (error) {
      console.error('API test failed:', error);
      return false;
    }
  }
  
  // Function to save settings and notify other parts of the extension
  async function saveSettingsAndNotify(settings) {
    try {
      console.log('Saving settings:', settings);
      
      // Save settings to storage
      await saveSettings(settings);
      console.log('Settings saved to storage');
      
      // Notify background script
      try {
        console.log('Notifying background script about settings update');
        await sendMessageToBackground({
          action: 'updateSettings',
          settings: settings
        });
        console.log('Background script notified successfully');
      } catch (error) {
        console.error('Error notifying background script:', error);
        // Continue even if background notification fails
      }
      
      // Try to notify content script if on Twitter
      try {
        console.log('Checking if we are on Twitter to notify content script');
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        
        if (tabs.length === 0) {
          console.log('No active tabs found');
          return;
        }
        
        const currentTab = tabs[0];
        console.log('Current tab:', currentTab.url);
        
        if (currentTab && (currentTab.url.includes('twitter.com') || currentTab.url.includes('x.com'))) {
          console.log('On Twitter/X, attempting to notify content script');
          
          try {
            await sendMessageToContent(currentTab.id, {
              action: 'updateSettings',
              settings: settings
            });
            console.log('Content script notified successfully');
          } catch (error) {
            // This is expected if not on Twitter or content script not loaded
            console.log('Content script notification failed (this is normal if not on Twitter):', error.message);
            
            // If we're on Twitter but got an error, the content script might not be loaded yet
            // Let's inject it manually
            if (currentTab.url.includes('twitter.com') || currentTab.url.includes('x.com')) {
              console.log('On Twitter but content script not responding, it might not be loaded yet');
              // We don't need to do anything here, as the content script should be injected automatically
              // when navigating to Twitter. This is just for logging purposes.
            }
          }
        } else {
          console.log('Not on Twitter/X, skipping content script notification');
        }
      } catch (error) {
        console.log('Error checking current tab:', error);
      }
    } catch (error) {
      console.error('Error in saveSettingsAndNotify:', error);
    }
  }
  
  // Toggle automation on/off
  automationToggle.addEventListener('change', function() {
    updateStatusMessage(automationToggle.checked);
  });
  
  // Update status message based on automation state
  function updateStatusMessage(isEnabled) {
    if (isEnabled) {
      statusMessage.textContent = 'Automation is active. The extension will engage with tweets automatically.';
      statusMessage.style.backgroundColor = '#d4edda'; // Success color
    } else {
      statusMessage.textContent = 'Automation is inactive. Toggle to activate.';
      statusMessage.style.backgroundColor = '#f8d7da'; // Error color
    }
  }
}); 