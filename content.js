// Twitter Engagement Automator - Content Script

// Global settings
let settings = {
  automationEnabled: false,
  likeEnabled: true,
  commentEnabled: true,
  followEnabled: true,
  debugMode: false,
  apiKey: '',
  apiEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
  model: 'llama-3.3-70b-versatile'
};

// Track processed tweets to avoid duplicates
const processedTweets = new Set();
const followedUsers = new Set();
const commentedTweets = new Set(); // Track tweets we've already commented on
const repliedToUsers = new Set(); // NEW: Track users we've already replied to
const apiRequestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 5000; // Reduced to 5 seconds between requests
let isProcessingTweets = false; // Flag to prevent concurrent processing

// List of blocked usernames (don't interact with these accounts)
const BLOCKED_USERNAMES = ['Anubhavhing']; // NEW: Add usernames to block

// Debug logging function
function debugLog(...args) {
  if (settings.debugMode) {
    console.log('[Twitter Automator]', ...args);
  }
}

// Initialize the extension
function initialize() {
  console.log('Twitter Engagement Automator initialized');
  
  // Load settings
  loadSettings().then(items => {
    settings = items;
    debugLog('Settings loaded:', settings);
    
    // Check if API key is provided when automation is enabled
    if (settings.automationEnabled) {
      if (!settings.apiKey) {
        console.error('API key is required for automation. Disabling automation.');
        settings.automationEnabled = false;
        
        // Show notification to user
        showNotification('API Key Required', 'Please enter your Groq API key in the extension settings to enable automation.');
        
        // Save settings to persist the disabled state
        saveSettings({
          ...settings,
          automationEnabled: false
        }).catch(error => {
          console.error('Error saving settings:', error);
        });
      } else {
        startAutomation();
      }
    }
  }).catch(error => {
    console.error('Error loading settings:', error);
  });
  
  // Listen for messages from popup or background
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log('Content script received message:', message, 'from sender:', sender);
    
    if (message.action === 'updateSettings') {
      settings = message.settings;
      debugLog('Settings updated:', settings);
      
      // Check if API key is provided when automation is enabled
      if (settings.automationEnabled) {
        if (!settings.apiKey) {
          console.error('API key is required for automation. Disabling automation.');
          settings.automationEnabled = false;
          
          // Show notification to user
          showNotification('API Key Required', 'Please enter your Groq API key in the extension settings to enable automation.');
          
          // Save settings to persist the disabled state
          saveSettings({
            ...settings,
            automationEnabled: false
          }).catch(error => {
            console.error('Error saving settings:', error);
          });
          
          // Acknowledge receipt
          console.log('Sending response to message:', { success: true, apiKeyMissing: true });
          sendResponse({ success: true, apiKeyMissing: true });
        } else {
          startAutomation();
          
          // Acknowledge receipt
          console.log('Sending response to message:', { success: true });
          sendResponse({ success: true });
        }
      } else {
        // Acknowledge receipt
        console.log('Sending response to message:', { success: true });
        sendResponse({ success: true });
      }
    }
    return true;
  });
}

// Start the automation process
function startAutomation() {
  debugLog('Starting automation');
  
  // Process visible tweets immediately
  processVisibleTweets();
  
  // Set up a mutation observer to detect new tweets
  setupTweetObserver();
  
  // Process tweets periodically as user scrolls, but much less frequently
  setInterval(processVisibleTweets, 30000); // Check for new tweets every 60 seconds
}

// Set up mutation observer to detect new tweets
function setupTweetObserver() {
  const targetNode = document.body;
  const config = { childList: true, subtree: true };
  
  const callback = function(mutationsList, observer) {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Wait longer for the DOM to settle
        setTimeout(processVisibleTweets, 10000); // Wait 10 seconds before processing new tweets
        break;
      }
    }
  };
  
  const observer = new MutationObserver(callback);
  observer.observe(targetNode, config);
}

// Process all visible tweets on the page
async function processVisibleTweets() {
  if (!settings.automationEnabled || isProcessingTweets) {
    debugLog('Automation disabled or already processing tweets, skipping');
    return;
  }
  
  isProcessingTweets = true;
  debugLog('Processing visible tweets');
  
  try {
    // Check if we're in a section where we shouldn't process tweets
    const currentUrl = window.location.href;
    if (currentUrl.includes('/replies') || 
        currentUrl.includes('/with_replies') || 
        currentUrl.includes('/status/')) {
      debugLog('In replies or conversation section, skipping automation');
      isProcessingTweets = false;
      return;
    }
    
    // Check if a reply dialog is open - if so, skip processing
    const replyDialog = document.querySelector('[aria-labelledby="modal-header"]');
    if (replyDialog) {
      debugLog('Reply dialog is open, skipping automation');
      isProcessingTweets = false;
      return;
    }
    
    // Find all tweet articles
    // Twitter's DOM structure might change, so we need to adapt the selectors
    const tweetArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    
    // Filter out already processed tweets
    const unprocessedTweets = tweetArticles.filter(article => {
      const tweetId = article.getAttribute('aria-labelledby');
      
      // Skip tweets that are inside a reply dialog
      if (article.closest('[aria-labelledby="modal-header"]')) {
        return false;
      }
      
      return tweetId && !processedTweets.has(tweetId);
    });
    
    debugLog(`Found ${unprocessedTweets.length} unprocessed tweets`);
    
    // Process tweets one by one
    for (const article of unprocessedTweets) {
      try {
        // Get tweet ID or some unique identifier
        const tweetId = article.getAttribute('aria-labelledby');
        
        // Mark as processed to avoid duplicates
        processedTweets.add(tweetId);
        
        debugLog('Processing tweet:', tweetId);
        
        // Extract tweet content for AI comment generation
        const tweetText = extractTweetText(article);
        const username = extractUsername(article);
        
        debugLog('Tweet text:', tweetText ? tweetText.substring(0, 50) + '...' : 'No text');
        debugLog('Username:', username);
        
        // NEW: Skip if username is in the blocked list
        if (username && BLOCKED_USERNAMES.includes(username)) {
          debugLog('Skipping blocked user: ' + username);
          continue;
        }
        
        // NEW: Skip if we've already replied to this user
        if (username && repliedToUsers.has(username)) {
          debugLog('Already replied to user ' + username + ', skipping');
          continue;
        }
        
        // Check if this is our own comment to avoid loops
        const isOwnComment = checkIfOwnComment(article);
        if (isOwnComment) {
          debugLog('Skipping our own comment to avoid loops');
          continue;
        }
        
        // Scroll the tweet into view
        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(1000); // Reduced wait for scroll to complete
        
        // Perform actions based on settings
        if (settings.likeEnabled) {
          await likeTweet(article);
          await sleep(getRandomDelay(1000, 2000)); // Reduced wait between actions
        }
        
        if (settings.followEnabled && username && !BLOCKED_USERNAMES.includes(username)) {
          await followUser(article, username);
          await sleep(getRandomDelay(1000, 2000)); // Reduced wait between actions
        }
        
        if (settings.commentEnabled && tweetText && username && !BLOCKED_USERNAMES.includes(username)) {
          const success = await commentOnTweet(article, tweetText, username);
          if (success && username) {
            repliedToUsers.add(username); // Track that we've replied to this user
          }
          // Reduced delay after commenting
          await sleep(getRandomDelay(3000, 5000));
        }
        
        // Reduced delay between processing tweets
        await sleep(getRandomDelay(3000, 5000));
        
        // Only process one tweet at a time to avoid overwhelming the API
        break;
      } catch (error) {
        console.error('Error processing tweet:', error);
        await sleep(2000); // Wait a bit before continuing to the next tweet
      }
    }
  } catch (error) {
    console.error('Error in processVisibleTweets:', error);
  } finally {
    isProcessingTweets = false;
    debugLog('Finished processing tweets');
  }
}

// Extract the text content of a tweet
function extractTweetText(article) {
  try {
    // Try multiple selectors for tweet text
    const textSelectors = [
      '[data-testid="tweetText"]',
      'div[lang]',
      'div[data-testid="tweetText"] span',
      'article div[dir="auto"]'
    ];
    
    for (const selector of textSelectors) {
      const elements = article.querySelectorAll(selector);
      if (elements.length > 0) {
        // Combine text from all matching elements
        let tweetText = '';
        elements.forEach(element => {
          // Skip elements that are likely not part of the main tweet text
          if (element.closest('[data-testid="card.wrapper"]') || 
              element.closest('[data-testid="User-Name"]') ||
              element.closest('[data-testid="socialContext"]')) {
            return;
          }
          
          const text = element.textContent.trim();
          if (text) {
            tweetText += (tweetText ? ' ' : '') + text;
          }
        });
        
        if (tweetText) {
          console.log(`Found tweet text with selector: ${selector}, text: ${tweetText.substring(0, 50)}...`);
          return tweetText;
        }
      }
    }
    
    console.log('Tweet text not found with any selector');
    return '';
  } catch (error) {
    console.error('Error extracting tweet text:', error);
    return '';
  }
}

// Extract the username from a tweet
function extractUsername(article) {
  try {
    // Try multiple selectors for username
    const usernameSelectors = [
      '[data-testid="User-Name"] a:nth-child(2)',
      '[data-testid="User-Name"] a[href*="/"]',
      'a[role="link"][href*="/"]',
      'div[data-testid="User-Name"] > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > a:nth-child(1)',
      'div[data-testid="User-Name"] a'
    ];
    
    for (const selector of usernameSelectors) {
      const elements = article.querySelectorAll(selector);
      for (const element of elements) {
        // Check if this looks like a username (starts with @)
        const text = element.textContent.trim();
        if (text.startsWith('@')) {
          console.log(`Found username with selector: ${selector}, username: ${text}`);
          return text.substring(1); // Remove the @ symbol
        }
        
        // Check if it's a username without the @ symbol
        const href = element.getAttribute('href');
        if (href && href.includes('/') && !href.includes('search') && !href.includes('explore')) {
          const parts = href.split('/').filter(part => part.length > 0);
          if (parts.length > 0) {
            const username = parts[parts.length - 1];
            console.log(`Extracted username from href with selector: ${selector}, username: ${username}`);
            return username;
          }
        }
      }
    }
    
    console.log('Username not found with any selector');
    return '';
  } catch (error) {
    console.error('Error extracting username:', error);
    return '';
  }
}

// Like a tweet
async function likeTweet(article) {
  try {
    // Try multiple selectors for the like button
    const likeSelectors = [
      '[data-testid="like"]',
      '[aria-label="Like"]',
      '[aria-label="like"]',
      'div[role="button"] svg[viewBox="0 0 24 24"][aria-hidden="true"]'
    ];
    
    let likeButton = null;
    
    // Try each selector
    for (const selector of likeSelectors) {
      const button = article.querySelector(selector);
      if (button) {
        console.log(`Found like button with selector: ${selector}`);
        likeButton = button;
        break;
      }
    }
    
    if (likeButton) {
      debugLog('Liking tweet');
      likeButton.click();
      await sleep(getRandomDelay(500, 1500));
    } else {
      console.log('Like button not found');
    }
  } catch (error) {
    console.error('Error liking tweet:', error);
  }
}

// Follow a user
async function followUser(article, username) {
  try {
    if (followedUsers.has(username) || !username) return;
    
    // Try multiple selectors for the follow button
    const followSelectors = [
      '[data-testid="followButton"]',
      '[aria-label="Follow @' + username + '"]',
      '[aria-label="follow"]',
      '[aria-label="Follow"]',
      'div[role="button"]:not([data-testid="like"]):not([data-testid="reply"])'
    ];
    
    let followButton = null;
    
    // Try each selector
    for (const selector of followSelectors) {
      const buttons = article.querySelectorAll(selector);
      // Look for a button that contains text like "Follow"
      for (const button of buttons) {
        const buttonText = button.textContent.toLowerCase();
        if (buttonText.includes('follow') && !buttonText.includes('following') && !buttonText.includes('unfollow')) {
          followButton = button;
          console.log(`Found follow button with selector: ${selector}, text: ${buttonText}`);
          break;
        }
      }
      if (followButton) break;
    }
    
    if (followButton) {
      debugLog('Following user:', username);
      followButton.click();
      followedUsers.add(username);
      await sleep(getRandomDelay(500, 1500));
    } else {
      console.log('Follow button not found for user:', username);
    }
  } catch (error) {
    console.error('Error following user:', error);
  }
}

// Comment on a tweet
async function commentOnTweet(article, tweetText, username) {
  try {
    // Get tweet ID to track commented tweets
    const tweetId = article.getAttribute('aria-labelledby');
    
    // Skip if we've already commented on this tweet
    if (commentedTweets.has(tweetId)) {
      debugLog('Already commented on tweet:', tweetId);
      return false;
    }
    
    // NEW: Skip if username is in the blocked list
    if (username && BLOCKED_USERNAMES.includes(username)) {
      debugLog('Skipping comment on blocked user: ' + username);
      return false;
    }
    
    // NEW: Skip if we've already replied to this user
    if (username && repliedToUsers.has(username)) {
      debugLog('Already replied to user ' + username + ', skipping comment');
      return false;
    }
    
    // Check if there's an indicator that we've already replied
    const alreadyRepliedIndicator = article.querySelector('[data-testid="socialContext"]');
    if (alreadyRepliedIndicator && alreadyRepliedIndicator.textContent.includes('You replied')) {
      debugLog('Twitter indicates we already replied to this tweet');
      commentedTweets.add(tweetId);
      if (username) repliedToUsers.add(username);
      return false;
    }
    
    debugLog('Commenting on tweet with text:', tweetText);
    
    // Generate a comment BEFORE clicking the reply button
    // This avoids timing issues with the dialog opening
    console.log('Generating comment for tweet');
    const comment = await generateComment(tweetText);
    console.log('Generated comment:', comment);
    
    if (!comment) {
      console.log('No comment generated due to API error, stopping automation');
      return false;
    }
    
    // Find the reply button with multiple selectors for better reliability
    let replyButton = article.querySelector('[data-testid="reply"]');
    
    // If the primary selector fails, try alternative selectors
    if (!replyButton) {
      console.log('Primary reply button selector failed, trying alternatives');
      
      // Try alternative selectors
      const possibleSelectors = [
        '[aria-label="Reply"]',
        '[aria-label="reply"]',
        'div[role="button"][data-testid="reply"]',
        'div[role="button"] svg[viewBox="0 0 24 24"][aria-hidden="true"]'
      ];
      
      for (const selector of possibleSelectors) {
        const button = article.querySelector(selector);
        if (button) {
          console.log(`Found reply button with selector: ${selector}`);
          replyButton = button;
          break;
        }
      }
    }
    
    if (!replyButton) {
      console.log('Reply button not found for tweet:', tweetId);
      return false;
    }
    
    // Now click the reply button to open the comment dialog
    console.log('Clicking reply button');
    replyButton.click();
    await sleep(10000); // Reduced wait for dialog to open
    
    // Try multiple selectors for the tweet input field
    const inputSelectors = [
      // Specific selectors for the Draft.js editor structure
      'div.notranslate.public-DraftEditor-content[contenteditable="true"][data-testid="tweetTextarea_0"]',
      'div.public-DraftEditor-content[contenteditable="true"][data-testid="tweetTextarea_0"]',
      'div.public-DraftEditor-content[contenteditable="true"]',
      'div[aria-activedescendant][aria-autocomplete="list"][aria-label="Post text"][contenteditable="true"][data-testid="tweetTextarea_0"]',
      
      // More general selectors
      '[data-testid="tweetTextarea_0"]',
      'div[aria-label="Post text"][contenteditable="true"]',
      'div[data-testid="tweetTextarea_0"][contenteditable="true"]',
      'div[aria-label="Tweet text"]',
      'div[aria-label="Post text"]',
      'div[data-contents="true"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[data-testid="tweetTextInput"]'
    ];
    
    let tweetInput = null;
    
    // Try each selector
    for (const selector of inputSelectors) {
      const input = document.querySelector(selector);
      if (input) {
        console.log(`Found tweet input with selector: ${selector}`);
        tweetInput = input;
        break;
      }
    }
    
    if (!tweetInput) {
      console.log('Tweet input field not found after multiple attempts');
      
      // Try to find any visible textbox in the reply dialog
      const replyDialog = document.querySelector('[aria-labelledby="modal-header"]');
      if (replyDialog) {
        const possibleInputs = replyDialog.querySelectorAll('div[role="textbox"], textarea, [contenteditable="true"]');
        if (possibleInputs.length > 0) {
          tweetInput = possibleInputs[0];
          console.log('Found potential input field in reply dialog');
        }
      }
      
      // If still not found, close the dialog and return
      if (!tweetInput) {
        console.log('No suitable input field found, closing dialog');
        const closeButton = document.querySelector('[data-testid="app-bar-close"]');
        if (closeButton) closeButton.click();
        await sleep(30000); // Wait 30 seconds before closing
        return false;
      }
    }
    
    // After finding the input field, try to directly find and manipulate the span structure
    if (tweetInput) {
      console.log('Found tweet input, now looking for span structure');
      
      // Try to find the specific span structure
      const dataOffsetSpan = tweetInput.querySelector('span[data-offset-key]');
      if (dataOffsetSpan) {
        console.log('Found span with data-offset-key, attempting direct manipulation');
        
        // Try to set the text directly in this span
        try {
          dataOffsetSpan.textContent = comment;
          dataOffsetSpan.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Also try to find the inner span with data-text="true"
          const dataTextSpan = dataOffsetSpan.querySelector('span[data-text="true"]');
          if (dataTextSpan) {
            console.log('Found inner span with data-text="true"');
            dataTextSpan.textContent = comment;
            dataTextSpan.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          // Dispatch events on the main input
          tweetInput.dispatchEvent(new Event('input', { bubbles: true }));
          tweetInput.dispatchEvent(new Event('change', { bubbles: true }));
          
          console.log('Direct span manipulation completed');
        } catch (spanError) {
          console.error('Error manipulating span directly:', spanError);
        }
      }
    }
    
    console.log('Setting comment text in input field');
    
    // Use multiple approaches to set the text
    try {
      // For Draft.js editor (Twitter's specific implementation)
      if (tweetInput.classList.contains('public-DraftEditor-content') || 
          tweetInput.getAttribute('data-testid') === 'tweetTextarea_0') {
        console.log('Using Draft.js editor approach');
        
        // First focus the input
        tweetInput.focus();
        
        // Try multiple approaches for Draft.js
        
        // 1. Try to find and modify the span tag where text should be inserted
        try {
          console.log('Trying span tag approach for Draft.js editor');
          
          // Look for the span tag structure
          const spanElement = tweetInput.querySelector('span[data-text="true"]');
          if (spanElement) {
            console.log('Found span element for text insertion');
            spanElement.textContent = comment;
            
            // Dispatch events on the span
            ['input', 'change'].forEach(eventType => {
              spanElement.dispatchEvent(new Event(eventType, { bubbles: true }));
            });
            
            // Also dispatch events on the parent elements
            let parent = spanElement.parentElement;
            while (parent && parent !== tweetInput) {
              ['input', 'change'].forEach(eventType => {
                parent.dispatchEvent(new Event(eventType, { bubbles: true }));
              });
              parent = parent.parentElement;
            }
          } else {
            // If span not found, try to create the proper structure
            console.log('Span element not found, trying to create structure');
            
            // Find or create the necessary structure
            let dataContentsDiv = tweetInput.querySelector('div[data-contents="true"]');
            if (!dataContentsDiv) {
              dataContentsDiv = document.createElement('div');
              dataContentsDiv.setAttribute('data-contents', 'true');
              tweetInput.appendChild(dataContentsDiv);
            }
            
            // Create the span structure
            const spanHTML = `<div data-block="true"><div class="public-DraftStyleDefault-block public-DraftStyleDefault-ltr"><span data-text="true">${comment}</span></div></div>`;
            dataContentsDiv.innerHTML = spanHTML;
          }
        } catch (spanError) {
          console.log('Span tag approach failed:', spanError);
          
          // 2. Try execCommand approach as fallback
          try {
            // Clear existing content
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            
            // Insert new content
            document.execCommand('insertText', false, comment);
            console.log('Used execCommand to insert text');
          } catch (execError) {
            console.log('execCommand approach failed:', execError);
            
            // 3. Try inner div approach
            const innerDiv = tweetInput.querySelector('div[data-contents="true"] div[data-block="true"] div');
            if (innerDiv) {
              console.log('Found inner div for Draft.js editor');
              innerDiv.textContent = comment;
            } else {
              // 4. If inner div not found, try direct approach
              tweetInput.textContent = comment;
            }
          }
        }
        
        // Dispatch necessary events on the main input element
        ['input', 'change', 'keydown', 'keyup'].forEach(eventType => {
          tweetInput.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
        
        // Simulate Enter key press to ensure Draft.js registers the change
        tweetInput.dispatchEvent(new KeyboardEvent('keydown', { 
          bubbles: true, 
          cancelable: true, 
          keyCode: 13 
        }));
        tweetInput.dispatchEvent(new KeyboardEvent('keyup', { 
          bubbles: true, 
          cancelable: true, 
          keyCode: 13 
        }));
      }
      // For contenteditable divs
      else if (tweetInput.getAttribute('contenteditable') === 'true') {
        console.log('Using contenteditable approach');
        tweetInput.innerHTML = comment;
        tweetInput.dispatchEvent(new Event('input', { bubbles: true }));
        tweetInput.dispatchEvent(new Event('change', { bubbles: true }));
      } 
      // For standard inputs/textareas
      else if (tweetInput.tagName === 'TEXTAREA' || tweetInput.tagName === 'INPUT') {
        console.log('Using standard input approach');
        tweetInput.value = comment;
        tweetInput.dispatchEvent(new Event('input', { bubbles: true }));
        tweetInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // For other elements, try both approaches
      else {
        console.log('Using combined approach');
        // Try setting innerHTML
        tweetInput.innerHTML = comment;
        // Also try setting value
        if ('value' in tweetInput) {
          tweetInput.value = comment;
        }
        
        // Dispatch events
        ['input', 'change', 'keydown', 'keyup', 'keypress'].forEach(eventType => {
          tweetInput.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
      }
      
      // Focus the input
      tweetInput.focus();
      
      // Simulated typing as a fallback
      if ((!tweetInput.value && !tweetInput.innerHTML) || 
          (tweetInput.value !== comment && tweetInput.innerHTML !== comment && 
           tweetInput.textContent !== comment)) {
        console.log('Primary methods failed, trying simulated typing');
        
        // Try to find the span element first for Draft.js
        const spanElement = tweetInput.querySelector('span[data-text="true"]');
        if (spanElement) {
          console.log('Found span element for simulated typing');
          
          // Clear the span first
          spanElement.textContent = '';
          
          // Type character by character into the span
          for (let i = 0; i < comment.length; i++) {
            spanElement.textContent += comment[i];
            
            // Dispatch events on both the span and the input
            spanElement.dispatchEvent(new Event('input', { bubbles: true }));
            tweetInput.dispatchEvent(new Event('input', { bubbles: true }));
            
            await sleep(10); // Small delay between characters
          }
          
          // Final events after typing is complete
          ['change', 'keydown', 'keyup'].forEach(eventType => {
            spanElement.dispatchEvent(new Event(eventType, { bubbles: true }));
            tweetInput.dispatchEvent(new Event(eventType, { bubbles: true }));
          });
        }
        // If no span element, fall back to previous methods
        else {
          // Clear the input first
          if (tweetInput.getAttribute('contenteditable') === 'true') {
            tweetInput.innerHTML = '';
          } else if ('value' in tweetInput) {
            tweetInput.value = '';
          } else {
            tweetInput.textContent = '';
          }
          tweetInput.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Type character by character
          for (let i = 0; i < comment.length; i++) {
            if (tweetInput.getAttribute('contenteditable') === 'true') {
              tweetInput.innerHTML += comment[i];
            } else if ('value' in tweetInput) {
              tweetInput.value += comment[i];
            } else {
              tweetInput.textContent += comment[i];
            }
            
            // Dispatch input event after each character
            tweetInput.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(10); // Small delay between characters
          }
        }
      }
      
      // Final check
      console.log('Final input state:', tweetInput.value || tweetInput.innerHTML || tweetInput.textContent);
    } catch (inputError) {
      console.error('Error setting input value:', inputError);
      console.error('Error stack:', inputError.stack);
    }
    
    // Wait for 30 seconds before submitting or closing
    console.log('Waiting 30 seconds before submitting comment...');
    await sleep(5000);
    
    // Try multiple selectors for the submit button
    const submitSelectors = [
      '[data-testid="tweetButton"]',
      'div[role="button"][data-testid="tweetButtonInline"]',
      'div[role="button"]:not([aria-disabled="true"]):not([data-testid="app-bar-close"])',
      'div[role="button"][tabindex="0"]'
    ];
    
    let submitButton = null;
    
    // Try each selector
    for (const selector of submitSelectors) {
      const buttons = document.querySelectorAll(selector);
      // Look for a button that contains text like "Reply" or "Tweet"
      for (const button of buttons) {
        const buttonText = button.textContent.toLowerCase();
        if (buttonText.includes('reply') || buttonText.includes('tweet') || buttonText.includes('post')) {
          submitButton = button;
          console.log(`Found submit button with selector: ${selector}, text: ${buttonText}`);
          break;
        }
      }
      if (submitButton) break;
    }
    
    if (submitButton && !submitButton.disabled && !submitButton.getAttribute('aria-disabled') === 'true') {
      console.log('Clicking submit button');
      submitButton.click();
      commentedTweets.add(tweetId); // Mark as commented
      await sleep(5000); // Wait after posting
    } else {
      console.log('Submit button not found or disabled');
      // Try to find any button that might be the submit button
      const allButtons = document.querySelectorAll('div[role="button"]');
      let found = false;
      
      for (const button of allButtons) {
        const buttonText = button.textContent.toLowerCase();
        if ((buttonText.includes('reply') || buttonText.includes('tweet') || buttonText.includes('post')) && 
            !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
          console.log('Found potential submit button with text:', buttonText);
          button.click();
          commentedTweets.add(tweetId);
          found = true;
          await sleep(5000);
          break;
        }
      }
      
      // If still not found, close the dialog
      if (!found) {
        console.log('No suitable submit button found, closing dialog');
        const closeButton = document.querySelector('[data-testid="app-bar-close"]');
        if (closeButton) closeButton.click();
        await sleep(5000); // Wait after closing
      }
    }
    
    // After successful comment submission:
    commentedTweets.add(tweetId); // Mark as commented
    if (username) repliedToUsers.add(username); // Track the user we replied to
    return true;
  } catch (error) {
    console.error('Error commenting on tweet:', error);
    console.error('Error stack:', error.stack);
    // Try to close the reply dialog if there was an error
    const closeButton = document.querySelector('[data-testid="app-bar-close"]');
    if (closeButton) closeButton.click();
    await sleep(3000); // Reduced wait after closing on error
    return false;
  }
}

// Generate a comment using the Groq API
async function generateComment(tweetText) {
  return new Promise((resolve) => {
    // Add request to queue
    apiRequestQueue.push({
      tweetText,
      callback: resolve
    });
    
    // Process queue if not already processing
    if (!isProcessingQueue) {
      processApiQueue();
    }
  });
}

// Process the API request queue with rate limiting
async function processApiQueue() {
  if (apiRequestQueue.length === 0) {
    isProcessingQueue = false;
    return;
  }
  
  isProcessingQueue = true;
  
  // Ensure we respect rate limits
  const now = Date.now();
  const timeToWait = Math.max(0, MIN_REQUEST_INTERVAL - (now - lastRequestTime));
  
  if (timeToWait > 0) {
    await sleep(timeToWait);
  }
  
  const request = apiRequestQueue.shift();
  
  try {
    const comment = await callGroqApi(request.tweetText);
    request.callback(comment);
    
    // If API call failed, disable automation
    if (!comment) {
      console.error('API call failed, disabling automation');
      settings.automationEnabled = false;
      
      // Show notification to user
      showNotification('API Error', 'Failed to connect to Groq API. Automation has been disabled.');
      
      // Save settings to persist the disabled state
      saveSettings({
        ...settings,
        automationEnabled: false
      }).catch(error => {
        console.error('Error saving settings:', error);
      });
      
      // Clear the queue
      apiRequestQueue.length = 0;
      isProcessingQueue = false;
      return;
    }
  } catch (error) {
    console.error('Error calling Groq API:', error);
    request.callback(null);
    
    // Disable automation on error
    console.error('API call error, disabling automation');
    settings.automationEnabled = false;
    
    // Show notification to user
    showNotification('API Error', 'Error connecting to Groq API: ' + error.message + '. Automation has been disabled.');
    
    // Save settings to persist the disabled state
    saveSettings({
      ...settings,
      automationEnabled: false
    }).catch(error => {
      console.error('Error saving settings:', error);
    });
    
    // Clear the queue
    apiRequestQueue.length = 0;
    isProcessingQueue = false;
    return;
  }
  
  lastRequestTime = Date.now();
  
  // Process next item in queue
  processApiQueue();
}

// Helper function to handle API responses
function handleApiResponse(response) {
  if (!response) {
    console.error('No response received from API');
    return null;
  }
  
  if (response.error) {
    console.error('API error:', response.error);
    return null;
  }
  
  if (!response.data || !response.data.choices || !response.data.choices[0] || 
      !response.data.choices[0].message || !response.data.choices[0].message.content) {
    console.error('Invalid API response format:', response);
    return null;
  }
  
  // Extract just the content from the response
  let comment = response.data.choices[0].message.content.trim();
  
  // Remove quotes if present (the API sometimes returns the comment in quotes)
  if (comment.startsWith('"') && comment.endsWith('"')) {
    comment = comment.substring(1, comment.length - 1).trim();
  }
  
  if (!comment) {
    console.error('Empty comment received from API');
    return null;
  }
  
  console.log('Extracted clean comment from API:', comment);
  return comment;
}

// Call the Groq API to generate a comment
async function callGroqApi(tweetText) {
  try {
    console.log('Attempting to generate comment via Groq API for tweet:', tweetText.substring(0, 50) + '...');
    console.log('Using API endpoint:', settings.apiEndpoint);
    
    // Use a try-catch block specifically for the API operation
    try {
      const prompt = `Generate a relevant, engaging, and positive comment for this tweet: "${tweetText}". The comment should be concise (max 280 characters), conversational, and sound natural. Don't use hashtags or emojis.`;
      
      // Create request body using Groq's format
      const requestBody = {
        model: settings.model || 'llama-3.3-70b-versatile', // Use the model from settings or default
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that generates engaging Twitter comments."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.7,
        top_p: 0.9
      };
      
      console.log('API request payload:', requestBody);
      
      // Send request through the background script to avoid CORS
      console.log('Sending API request through background script to avoid CORS');
      const response = await sendMessageToBackground({
        action: 'makeApiRequest',
        apiEndpoint: settings.apiEndpoint,
        apiKey: settings.apiKey,
        requestBody: requestBody
      });
      
      console.log('Received response from background script:', response);
      
      // Process the API response
      const comment = handleApiResponse(response);
      if (comment) {
        console.log('Successfully generated comment from Groq API:', comment);
        return comment;
      } else {
        console.log('Failed to get valid comment from API, stopping automation');
        return null;
      }
    } catch (apiError) {
      console.error('Error in API request:', apiError);
      console.error('Error details:', apiError.message);
      return null;
    }
  } catch (error) {
    console.error('Error in callGroqApi function:', error);
    return null;
  }
}

// Helper function for random delays to make automation look more natural
function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper function to sleep for a specified time
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Show a notification to the user
function showNotification(title, message) {
  // Create a notification element
  const notification = document.createElement('div');
  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.right = '20px';
  notification.style.backgroundColor = '#f8d7da';
  notification.style.color = '#721c24';
  notification.style.padding = '15px';
  notification.style.borderRadius = '5px';
  notification.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
  notification.style.zIndex = '10000';
  notification.style.maxWidth = '300px';
  
  // Add title
  const titleElement = document.createElement('h3');
  titleElement.style.margin = '0 0 10px 0';
  titleElement.textContent = title;
  notification.appendChild(titleElement);
  
  // Add message
  const messageElement = document.createElement('p');
  messageElement.style.margin = '0';
  messageElement.textContent = message;
  notification.appendChild(messageElement);
  
  // Add close button
  const closeButton = document.createElement('button');
  closeButton.textContent = '×';
  closeButton.style.position = 'absolute';
  closeButton.style.top = '5px';
  closeButton.style.right = '10px';
  closeButton.style.background = 'none';
  closeButton.style.border = 'none';
  closeButton.style.fontSize = '20px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.color = '#721c24';
  closeButton.onclick = function() {
    document.body.removeChild(notification);
  };
  notification.appendChild(closeButton);
  
  // Add to body
  document.body.appendChild(notification);
  
  // Remove after 10 seconds
  setTimeout(() => {
    if (document.body.contains(notification)) {
      document.body.removeChild(notification);
    }
  }, 10000);
}

// Function to check if a tweet is our own comment - improved version
function checkIfOwnComment(article) {
  try {
    // Check for indicators that this is our own comment
    
    // 1. Check if the tweet has a "You replied" indicator
    const socialContext = article.querySelector('[data-testid="socialContext"]');
    if (socialContext && socialContext.textContent.includes('You replied')) {
      return true;
    }
    
    // 2. Check if the tweet has a "You" indicator (showing it's your own tweet)
    const userLabels = article.querySelectorAll('[data-testid="User-Name"] span');
    for (const label of userLabels) {
      if (label.textContent.includes('You')) {
        return true;
      }
    }
    
    // 3. Check for verified checkmark that appears next to your own name
    const verifiedBadges = article.querySelectorAll('svg[aria-label="Verified account"]');
    if (verifiedBadges.length > 0) {
      // Check if this verified badge is next to a "You" label
      for (const badge of verifiedBadges) {
        const parentElement = badge.closest('[data-testid="User-Name"]');
        if (parentElement && parentElement.textContent.includes('You')) {
          return true;
        }
      }
    }
    
    // 4. Check if the tweet was posted very recently (within the last minute)
    const timeElements = article.querySelectorAll('time');
    for (const timeEl of timeElements) {
      const timestamp = timeEl.getAttribute('datetime');
      if (timestamp) {
        const tweetTime = new Date(timestamp);
        const now = new Date();
        const diffSeconds = (now - tweetTime) / 1000;
        if (diffSeconds < 120) { // Less than 2 minutes old
          return true;
        }
      }
    }
    
    // 5. Check if we're in a reply thread where we've already commented
    const replyingToElements = article.querySelectorAll('[data-testid="reply"]');
    if (replyingToElements.length > 0) {
      // Check if this is in a conversation thread
      const conversationThread = article.closest('[aria-label*="Conversation"]');
      if (conversationThread) {
        // If we're in a conversation thread, check if any tweets in the thread are ours
        const threadsOwnTweets = conversationThread.querySelectorAll('[data-testid="User-Name"] span');
        for (const label of threadsOwnTweets) {
          if (label.textContent.includes('You')) {
            return true; // We've already participated in this thread
          }
        }
      }
    }
    
    // 6. Check if we're in the "Your replies" section
    const pageTitle = document.title;
    if (pageTitle.includes('Your replies') || pageTitle.includes('Replies')) {
      // If we're in the replies section, be more cautious
      return true;
    }
    
    // 7. Check if this tweet is a reply to someone we've already replied to
    const username = extractUsername(article);
    if (username && repliedToUsers.has(username)) {
      return true;
    }
    
    // 8. NEW: Check if this tweet is from a blocked username
    if (username && BLOCKED_USERNAMES.includes(username)) {
      return true; // Treat blocked users' tweets as if they were our own (to skip them)
    }
    
    return false;
  } catch (error) {
    console.error('Error checking if own comment:', error);
    return false; // If in doubt, assume it's not our comment
  }
}

// Initialize the extension when the page is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
} 