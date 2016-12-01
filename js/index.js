(function() {

  // mnemonics is populated as required by getLanguage
  var mnemonics = { "english": new Mnemonic("english") };
  var mnemonic = mnemonics["english"];
  var seed = null;
  var bip32RootKey = null;
  var bip32ExtendedKey = null;
  var network = bitcoin.networks.bitcoin;

  var phraseChangeTimeoutEvent = null;

  var DOM = {};
  DOM.phrase = $(".phrase");
  DOM.start = $(".start");
  DOM.disclaimer = $(".disclaimer");
  DOM.feedback = $(".feedback");
  DOM.pending = $(".pending");
  DOM.progress = $(".progress");

  var possiblePhrases = [];
  var batches = [[]];
  var batch1, batch2;

  var progressLog = "";

  // Most mistakes happen in the middle of the phrase, so we start replacing words in the middle and move out.  
  var testOrder = [6, 7, 5, 8, 4, 9, 3, 10, 2, 11, 1, 12];
  
  var n = { // universal counters
    test: 0, // which test position we are swapping words for
    word: 0, // which word we're swapping
    phrase: 0, // which phrase we are calculating an address for
    batch: 0, // which batch we are looking up via api
    batchaddr: 0, // how many addresses have been batched through api
    singleaddr: 0, // how many addresses have been individually checked through api
    totalsingleaddr: 0 //
  }

  var status = 0;

  // What the user has for their phrase, what language it's in, the word list for that language  
  var existingPhrase, language, words;
  
  var errorCount = 0;
  var processTimer;
  var apiTimer = 0;

  function init() {
    // Events
    DOM.phrase.on("input", delayedPhraseChanged);
    DOM.start.on("click", startClicked);
    DOM.disclaimer.change(disclaimed);

    DOM.phrase.focus(function(){
        if($(this).val() == "Enter your phrase here.") $(this).val("");
      }).blur(function(){
        if($(this).val() == "")$(this).val("Enter your phrase here.");
      });
    hidePending();
    hideValidationError();
  }

  // Event handlers

  function disclaimed() {
    if (DOM.disclaimer.is(':checked')) {
      DOM.disclaimer.attr("disabled", true);
      DOM.phrase.attr("readOnly", false);
      DOM.phrase.val("Enter your phrase here.");
      DOM.start.removeClass("greyed").addClass("start-btn");
    }
  }

  function delayedPhraseChanged() {
    hideValidationError();
    showPending();
    if (phraseChangeTimeoutEvent != null) {
      clearTimeout(phraseChangeTimeoutEvent);
    }
    phraseChangeTimeoutEvent = setTimeout(phraseChanged, 400);
  }

  function phraseChanged() {
    showPending();
    hideValidationError();
    setMnemonicLanguage();
    // Get the mnemonic phrase
    var errorText = findPhraseErrors(DOM.phrase.val().toLowerCase());
    if (errorText) {
      showValidationError(errorText);
      return;
    }
    hidePending();
  }

  function startClicked(event) {
    event.preventDefault();

    if (status == 0) {
      startRecovery();
    } else {
      stopRecovery();
    }
  }

// Button actions

  function startRecovery() {
    var validated = findPhraseErrors(DOM.phrase.val().toLowerCase());    
    if (validated != false) {
      showValidationError(validated);
      return;
    }
    
    progressLog = "";
    status = 1;

    DOM.start.text("Stop");
    DOM.start.removeClass("start-btn").addClass("stop-btn");
    DOM.phrase.attr("readOnly", true);
    addProgress("Generating possible combinations...");
    addProgress("Progress:");
    
    existingPhrase = phraseToWordArray(DOM.phrase.val().toLowerCase());
    language = getLanguage();
    words = WORDLISTS[language];

    startTime();
    runRecovery();
  }

  function stopRecovery() {
    if (status == 5) {
      DOM.progress.removeClass("success fail");
      progressLog = "";
      DOM.progress.html("");
    } else {
      addProgress("Aborted.");
    }
 
    status = 0;
    n = { test: 0, word: 0, phrase: 0, batch: 0, singleaddr: 0 }

    DOM.phrase.attr("readOnly", false);
    DOM.start.text("Start");
    DOM.start.removeClass("stop-btn").addClass("start-btn");
  }

  // Process management
  // Time-consuming loops can completely lock up the browser, so we use timeouts to break up each loop into segments and give the browser time to do other things in between. 
  // At the end of each segment, call runRecovery with settimeout, and based on the global "status" runRecovery will call the next segment to run.
  
  /*
   * Status:
   *    0 Stopped
   *    1 Calculating phrases
   *    2 Calculating addresses / Sending batches to API
   *    3 Finished calculating addresses
   *    4 Found a hit, narrowing it down via API
   *    5 Done.
   */

  function runRecovery() {
    switch (status) {
      case 0:
        break;
      case 1:
        generatePhrases();
        break;
      case 2:
        calculateAddresses();
        if ((new Date() - apiTimer) > 10000) {
          console.log("timed");
          apiTimer = new Date();
          checkAddressBatch();
        }
        break;
      case 3:
        if ((new Date() - apiTimer) > 10000) {
          console.log("timed");
          apiTimer = new Date();
          checkAddressBatch();
        }
        break;
      case 4:
        if ((new Date() - apiTimer) > 5000) {
          console.log("timed");
          apiTimer = new Date();
          divideAndConquer();
        }
        break;
      case 5:
        break;
    }
    setTimeout(runRecovery, 0);
  }

  // Recovery methods

  function generatePhrases() {
    
    if (n.word >= words.length) {
      n.test++;
      n.word = 0;
    }
    
    if (n.test >= testOrder.length) {
      // All phrases generated
      status = 2;

      updateProgress("Progress: 24576 / 24576 (Took " + parseTime(stopTime()) + ")");

      addProgress("Found " + possiblePhrases.length + " possibilities.");
      addProgress("Checking the blockchain for existing wallets...")
      addProgress("Progress:");
    
      startTime();
      return;
    }
    
    var toReplace = testOrder[n.test] - 1;

    for (; n.word < words.length; n.word++) {
      var testPhrase = [];

      // Generate phrase to test...

      if (existingPhrase.length == 11) {
       // If 11 words present
        for (var i = 0; i < 12; i++) {
          if (i < toReplace) {
            testPhrase.push(existingPhrase[i]);
          } else if (i > toReplace) {
            testPhrase.push(existingPhrase[i - 1]);
          } else {
            testPhrase.push(words[n.word]);
          }
        }

      } else {
        // If 12 words present
        for (var i = 0; i < 12; i++) {
          if (i == toReplace) {
            testPhrase.push(words[n.word]);
          } else {
            testPhrase.push(existingPhrase[i]);
          }
        }
      }      

      testPhrase = wordArrayToPhrase(testPhrase, language);

      // Check validity
      var isValid = mnemonic.check(testPhrase);

      if (isValid) {
        // Add possibility
        possiblePhrases.push(testPhrase);
      }

      if (n.word % 100 == 0) {
        var done = (n.word + (n.test * 2048));
        var remaining = 24576 - done;
        updateProgress("Progress: " + done + " / 24576");
        n.word++
        break;
      }
    }
  }

  function calculateAddresses() {
    if (n.phrase >= possiblePhrases.length) {
      // Finished calculating addresses. Just waiting on api callbacks.
      status = 3;
      updateProgress("Progress: " + possiblePhrases.length + " / " + possiblePhrases.length + " (Took " + parseTime(stopTime()) + ")");
      addProgress("Reviewing...")
      return;
    }

    // Put 128 addresses in each batch -- divideAndConquer is most efficient with a 2^n number of addresses  
    if (batches[batches.length - 1].length >= 128) {
      console.log("Starting new batch");
      batches.push([]);
    }

    calcBip32RootKeyFromSeed(possiblePhrases[n.phrase], "");
    calcBip32ExtendedKey("m/0'/0");

    var key = bip32ExtendedKey.derive(0);

    batches[batches.length - 1].push({ phrase: possiblePhrases[n.phrase], address: key.getAddress().toString()});
          
    updateProgress("Progress: " + n.phrase + " / "+ possiblePhrases.length + " (" + timeLeft(n.phrase, possiblePhrases.length - n.phrase) + " remaining)");
    n.phrase++;
  }

  // The API is rate limited　by number of calls but not by number of queries per call, so we ask for the status of multiple keys with one call
  function checkAddressBatch() {

    if (status == 0) return;
    
    // If no batches are ready yet, wait
    if (batches.length < 2 && status != 3) {      
      return;
    } 
    
    var addressList = "";

    for (var i = 0; i < batches[0].length; i++) {
      addressList += batches[0][i].address;
      if (i < batches[0].length - 1) addressList += "|";
    }
      
    console.log("Sending batch (" + (batches.length - 1) + " waiting)");

    $.get("https://blockchain.info/q/getreceivedbyaddress/" + addressList).done(function (data) {

      if (data != 0) {
        status = 4;

        // Get number of divides required, so we can give a visual indicator
        n.totalsingleaddr = calcSplitTimes(batches[0].length);

        splitBatch(batches[0]);
        
        updateProgress("Progress: " + n.phrase + " / " + possiblePhrases.length + " (Took " + parseTime(stopTime()) + ")");
        addProgress("Found something, analyzing...");
        addProgress("Progress: 0 / 7");

      } else {
        console.log("Got no hits.");
        if (status == 3 && batches.length <= 1) {
          fail();
        } else {
          batches.shift();
        }
      }
    }).fail(function (data) {
      errorCount++;
      if (errorCount > 4) {
        showValidationError("Connectivity errors. Please try again later.");
        stopRecovery();
      } else {
        apiTimer = new Date() - 5000;
      }
    });  
  }

  function divideAndConquer() {
    // We know one address in the latest batch has a balance, but we don't know which. By testing half the addresses,
    // throwing away the half that doesn't have a hit, and repeating, we can narrow it down in just a couple steps.

    var addressList = "";    
    for (var i = 0; i < batch1.length; i++) {
      addressList += batch1[i].address;
      if (i < batch1.length - 1) addressList += "|";
    }

    console.log(addressList);    
    $.get("https://blockchain.info/q/getreceivedbyaddress/" + addressList).done(function (data) {

      updateProgress("Progress: " + n.singleaddr + " / " + n.totalsingleaddr);
      n.singleaddr++;

      if (data != 0) {
        if (batch1.length == 1) {
          console.log(batch1[0].address);
          succeed(batch1[0].phrase);
          return;
        } else {
          console.log("Found in batch one, splitting " + batch1.length + " addresses into two.");
          splitBatch(batch1);
          apiTimer = new Date() - 5000;
        }
      } else {
        if (batch2.length == 1) {
          console.log(batch2[0].address);
          succeed(batch2[0].phrase);
          return;
        } else {
          console.log("Found in batch two, splitting " + batch2.length + " addresses into two.");
          splitBatch(batch2);
          apiTimer = new Date() - 5000;
        }
      }
    }).fail(function (data) {
      apiTimer = new Date() - 7000;
    });      
  }

  function splitBatch(batch) {
    var oldBatch = batch;
    var cutoff = Math.floor(batch.length / 2);
    batch1 = [];
    batch2 = [];

    for (var i = 0; i < cutoff; i++) {
      batch1.push(batch[i]);
    }

    for (; cutoff < batch.length; cutoff++) {
      batch2.push(batch[cutoff]);
    }
  }

  // Graphical

  function showValidationError(errorText) {
    hidePending();
    DOM.feedback
      .text(errorText)
      .show();
  }

  function hideValidationError() {
    DOM.feedback
      .text("")
      .hide();
  }

  function showPending() {
    hideValidationError();
    DOM.pending
      .text("Checking...")
      .show();
  }

  function hidePending() {
    DOM.pending
      .text("")
      .hide();
  }

  // Address generation and other tools

  function calcBip32RootKeyFromSeed(phrase, passphrase) {
    seed = mnemonic.toSeed(phrase, passphrase);
    bip32RootKey = bitcoin.HDNode.fromSeedHex(seed, network);
  }

  function calcBip32ExtendedKey(path) {
    bip32ExtendedKey = bip32RootKey;
    // Derive the key from the path
    var pathBits = path.split("/");
    for (var i=0; i<pathBits.length; i++) {
      var bit = pathBits[i];
      var index = parseInt(bit);
      if (isNaN(index)) {
        continue;
      }
      var hardened = bit[bit.length-1] == "'";
      if (hardened) {
        bip32ExtendedKey = bip32ExtendedKey.deriveHardened(index);
      }
      else {
        bip32ExtendedKey = bip32ExtendedKey.derive(index);
      }
    }
  }

  function findPhraseErrors(phrase) {
    // Preprocess the words
    phrase = mnemonic.normalizeString(phrase);
    var words = phraseToWordArray(phrase);
    
    // Check each word
    for (var i=0; i<words.length; i++) {
      var word = words[i];
      var language = getLanguage();
      if (WORDLISTS[language].indexOf(word) == -1) {
        console.log("Finding closest match to " + word);
        var nearestWord = findNearestWord(word);
        return '"' + word.charAt(0).toUpperCase() + word.slice(1) + '" is not a valid word. Did you mean "' + nearestWord + '"?';
      }
    }

    if ((words.length < 11 || words.length > 12) && words.length != 0) return "Must have 11 or 12 words of phrase.";
    
    return false;
  }

  function parseIntNoNaN(val, defaultVal) {
    var v = parseInt(val);
    if (isNaN(v)) {
      return defaultVal;
    }
    return v;
  }

  function findNearestWord(word) {
    var language = getLanguage();
    var words = WORDLISTS[language];
    var minDistance = 99;
    var closestWord = words[0];
    for (var i=0; i<words.length; i++) {
      var comparedTo = words[i];
      var distance = Levenshtein.get(word, comparedTo);
      if (distance < minDistance) {
        closestWord = comparedTo;
        minDistance = distance;
      }
    }
    return closestWord;
  }

  function getLanguage() {
    var defaultLanguage = "english";
    // Try to get from existing phrase
    var language = getLanguageFromPhrase();
    // Default to English if no other option
    return language.length == 0 ? defaultLanguage : language;
  }

  function getLanguageFromPhrase(phrase) {
    // Check if how many words from existing phrase match a language.
    var language = "";
    if (!phrase) {
      phrase = DOM.phrase.val();
    }
    if (phrase.length > 0) {
      var words = phraseToWordArray(phrase);
      var languageMatches = {};
      for (l in WORDLISTS) {
        // Track how many words match in this language
        languageMatches[l] = 0;
        for (var i=0; i<words.length; i++) {
          var wordInLanguage = WORDLISTS[l].indexOf(words[i]) > -1;
          if (wordInLanguage) {
            languageMatches[l]++;
          }
        }
        // Find languages with most word matches.
        // This is made difficult due to commonalities between Chinese
        // simplified vs traditional.
        var mostMatches = 0;
        var mostMatchedLanguages = [];
        for (var l in languageMatches) {
          var numMatches = languageMatches[l];
          if (numMatches > mostMatches) {
            mostMatches = numMatches;
            mostMatchedLanguages = [l];
          }
          else if (numMatches == mostMatches) {
            mostMatchedLanguages.push(l);
          }
        }
      }
      if (mostMatchedLanguages.length > 0) {
        // Use first language and warn if multiple detected
        language = mostMatchedLanguages[0];
        if (mostMatchedLanguages.length > 1) {
          console.warn("Multiple possible languages");
          console.warn(mostMatchedLanguages);
        }
      }
    }
    return language;
  }

  function setMnemonicLanguage() {
    var language = getLanguage();
    // Load the bip39 mnemonic generator for this language if required
    if (!(language in mnemonics)) {
      mnemonics[language] = new Mnemonic(language);
    }
    mnemonic = mnemonics[language];
  }

  function phraseToWordArray(phrase) {
    var words = phrase.split(/\s/g);
    var noBlanks = [];
    for (var i=0; i<words.length; i++) {
      var word = words[i];
      if (word.length > 0) {
        noBlanks.push(word);
      }
    }
    return noBlanks;
  }

  function wordArrayToPhrase(words, language) {
    var phrase = words.join(" ");
    if (typeof language == "undefined") language = getLanguageFromPhrase(phrase);
    if (language == "japanese") {
      phrase = words.join("\u3000");
    }
    return phrase;
  }

  // Output-related

  function addProgress(text) {
    progressLog += text + "<br>";
    DOM.progress.html(progressLog);
  }

  function updateProgress(text) {
    var old =progressLog.substring(0,progressLog.lastIndexOf("<br>", progressLog.length - 5));
    progressLog = old + "<br>" + text + "<br>";
    DOM.progress.html(progressLog);
  }

  function timeLeft(done, remain) {
    var soFar = Math.round(new Date() / 1000) - processTimer;
    var left = Math.round((soFar / done) * remain);
    return parseTime(left);    
  }

  function parseTime(total) {
    var min = Math.floor(total / 60);
    var sec = total - (min * 60); 
    if (min > 0) {
      return min + " minutes";
    } else {
      return sec + " seconds";
    }
  }

  function startTime() {
    processTimer = Math.round(new Date() / 1000);
  }

  function stopTime() {
    return Math.round((new Date() / 1000)) - processTimer;
  }

  function calcSplitTimes(items) {
    var splits = 0;
    while (items > 1) {
      items = Math.floor(items / 2);
      splits++;
    }
    return splits;
  }

  function comparePhraseForDisplay(phrase) {
    var wordArray = phraseToWordArray(phrase);
    for (var i = 0; i < wordArray.length; i++) { 
      if (wordArray[i] != existingPhrase[i]) {
        wordArray[i] = '<span class="missingWord">' + wordArray[i] + '</span>';
        break;
      }
    }
    wordArray[6] = '<br>' + wordArray[6];
    return wordArray.join(" ");
  }

  function succeed(phrase) {
    status = 5;
    DOM.start.text("Reset");

    DOM.progress.addClass("success");
    progressLog = '<div>Success! Your correct phrase is below: <br></div>' +
      '<div class="foundPhrase">' + comparePhraseForDisplay(phrase) + '</div>' +
      '<div class="donation-box">If you found this tool helpful, please consider making a donation to ' +
      '<a href="bitcoin://3NSgVhvdMdo6roBRBTafgk1UrBZmecgANv">3NSgVhvdMdo6roBRBTafgk1UrBZmecgANv</a> ➠</div>' +
      '<img src="images/qr_code.jpg" class="donation-image">';
    
    DOM.progress.html(progressLog);
  }

  function fail() {
    status = 5;
    DOM.start.text("Reset");
    DOM.progress.addClass("fail");
    addProgress('<br><br><span class="foundPhrase">Unfortunately, no valid phrase was found.</span>');
  }

  init();

})();
