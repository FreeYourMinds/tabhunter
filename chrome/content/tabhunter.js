// Copyright (C) Eric Promislow 2008 - 2015.  All Rights Reserved.
// See full license in tabhunter.js

try {

var globalMessageManager, Cc, Ci;

if (typeof(Cc) === "undefined") {
    Cc = Components.classes;
    Ci = Components.interfaces;
}

if (typeof(globalMessageManager) == "undefined") {
    var getGlobalMessageManager = function() {
        try {
            return Cc["@mozilla.org/globalmessagemanager;1"].getService(Ci.nsIMessageListenerManager);
        } catch(ex) {
            return false;
        }
    }
    globalMessageManager = getGlobalMessageManager();
}

var ep_extensions;
if (typeof(ep_extensions) == "undefined") {
    ep_extensions = {};
}
if (!("tabhunter" in ep_extensions)) {
    ep_extensions.tabhunter = { searchPattern:"" };
}
(function() {
    this.wmService = (Components.classes["@mozilla.org/appshell/window-mediator;1"].
                      getService(Components.interfaces.nsIWindowMediator));
    function TabInfo(windowIdx, tabIdx, label, image, location) {
        this.windowIdx = windowIdx;
        this.tabIdx = tabIdx;
        this.label = label;
        this.label_lc = this.label.toLowerCase();
        this.image = image;
        this.location = location;
    };
    
    // OUT ARGS: tabs: unordered array of [TabInfo]
    //           windowInfo: array of [window: ChromeWindow, tabs: array of [DOM tabs]]
    this.getTabs = function(callback) {
        try {
            if (globalMessageManager) {
                this.getTabs_dualProcess(callback);
            } else {
                this.getTabs_singleProcess(callback);
            }
        } catch(ex) {
            this.dump('tabhunter.js - getTabs - ' + ex + "\n" + ex.stack);
        }
    };
    
    this.getTabs_singleProcess = function(callback) {
        var obj = {};
        var openWindows = this.wmService.getEnumerator("navigator:browser");
        obj.tabs = [];
        obj.windowInfo = [];
        var windowIdx = -1;
        do {
            // There must be at least one window for an extension to run in
            var openWindow = openWindows.getNext();
            try {
                var tc = openWindow.getBrowser().tabContainer.childNodes;
            } catch(ex) {
                continue;
            }
            var currWindowInfo = obj.windowInfo[++windowIdx] = {
                window: openWindow,
                tabs: []
            }
            for (var i = 0; i < tc.length; i++) {
                var tab = tc[i];
                currWindowInfo.tabs.push(tab);
                var label = tab.label;
                var image = "";
                if (tab.linkedBrowser.contentDocument.contentType.indexOf("image/") != 0) {
                    image = tab.getAttribute('image');
                }
                this.dump('tabhunter.js - getTabs_singleProcess: image - <' + image + ">");
                obj.tabs.push(new TabInfo(windowIdx, i, label, image, tab.linkedBrowser.contentWindow.location.href));
            }
        } while (openWindows.hasMoreElements());
        callback(obj);
    };

    this.getTabs_dualProcessContinuation = function(msg) {
        try {
            if (!this.tabGetters) {
                this.dump(">> getTabs_dualProcessContinuation unexpected, ignore");
                return;
            }
            //this.dump(">> getTabs_dualProcessContinuation: msg: " + Object.keys(msg).join(" "));
        var data = msg.data;
            // this.dump(">> getTabs_dualProcessContinuation: data: " + Object.keys(data).join(" "));
            //this.dump("QQQ: and keys(this): " + Object.keys(this).join(" "));
        var tabIdx = data.tabIdx;
        var windowIdx = data.windowIdx;
        var windowTabKey = windowIdx + "-" + tabIdx;
        if (!this.processedTabs[windowTabKey]) {
            this.processedTabs[windowTabKey] = true;
        } else {
            this.dump(">> getTabs_dualProcessContinuation: already saw node " + windowTabKey);
            return;
        }
        var hasImage = data.hasImage;
        var location = data.location;
        this.dump("QQQ: getTabs_dualProcessContinuation: tabIdx: " + tabIdx +
                  ", windowIdx: " + windowIdx +
                  ", hasImage: " + hasImage +
                  ", location: " + location);
                  
        var tabGetter = this.tabGetters[windowIdx];
        this.dump("QQQ: windowIdx: " + windowIdx + ", tabGetter: " + tabGetter);
        var tab = tabGetter.tabs[tabIdx];
        this.dump("QQQ: tabGetter.collector.currWindowInfo: " + Object.keys(tabGetter.collector.currWindowInfo).join(", "));
        this.dump("QQQ: tabGetter.collector.currWindowInfo.tabs: " + Object.prototype.toString.call(tabGetter.collector.currWindowInfo.tabs));
        tabGetter.collector.currWindowInfo.tabs.push(tab);
        var label = tab.label;
        var image = data.hasImage ? tab.getAttribute('image') : '';
        tabGetter.collector.tabs.push(new TabInfo(windowIdx, tabIdx, label, image, location));
        this.dump("QQQ: window " + windowIdx +
                  ", now has " + tabGetter.collector.tabs.length + " tabs");
        if (tabIdx < tabGetter.tabs.length - 1) {
            setTimeout(function() {
            tabGetter.setImageSetting(tabIdx + 1);
                }, 10000);
        } else {
            this.dump("**** dualProcessContinuation: all done with window " + windowIdx);
            tabGetter.finishedGettingTabs = true;
            if (this.tabGetters.every(function(tabGetter) tabGetter.finishedGettingTabs)) {
                this.dump("**** all tabs are done, loop over " +
                          this.tabGetters.length + " tabs");
                clearTimeout(this.callbackTimeoutId);
                // pour everything into the return obj and
                // pass it on using the callback
                let result = { tabs:[], windowInfo:[] }
                this.tabGetters.forEach(function(tabGetter) {
                        try {
                        this.dump("QQQ: concat in " + tabGetter.collector.tabs.length + " tabs");
                        result.tabs = result.tabs.concat(tabGetter.collector.tabs);
                        this.dump("QQQ: result.windowInfo.push: " + tabGetter.collector.currWindowInfo);
                        result.windowInfo.push(tabGetter.collector.currWindowInfo);
                        } catch(e2) {
                            this.dump("**** this.tabGetters.forEach: bad: " + e2);
                        }
                    }.bind(this));
                this.dump("QQQ: result:tabs: " + result.tabs.length
                          + ", windowInfo: " + result.windowInfo.length);
                //TODO: XXX: dump result here, as it's coming back empty.
                this.tabGetterCallback(result);
            }
        }
        } catch(e) {
            this.dump("**** dualProcessContinuation: bad happened: " + e + "\n" + e.stack);
        }
    }
    if (globalMessageManager) {
        //globalMessageManager.addMessageListener("tabhunter@ericpromislow.com:docType-has-image-continuation", this.getTabs_dualProcessContinuation.bind(this));
        let this_ = this;
        globalMessageManager.addMessageListener("tabhunter@ericpromislow.com:docType-has-image-continuation", function(msg) {
                this_.dump("**** >>> Handling a docType-has-image-continuation notific'n");
                this_.getTabs_dualProcessContinuation(msg);
            });
    }
    
    this.TabGetter = function(windowIdx, openWindow, tabs) {
        this.windowIdx = windowIdx;
        this.openWindow = openWindow;
        this.tabs = tabs;
        this.finishedGettingTabs = false;
        this.collector = { tabs: [],
                           currWindowInfo: {window: openWindow, tabs: []}};
    };
    this.TabGetter.prototype.setImageSetting = function(tabIdx) {
        var tab = this.tabs[tabIdx];
        ep_extensions.tabhunter.dump("**** go do docType-has-image for windowIdx " +
                  this.windowIdx + ", tabIdx: " + tabIdx);
        tab.linkedBrowser.messageManager.sendAsyncMessage("tabhunter@ericpromislow.com:docType-has-image", { tabIdx: tabIdx, windowIdx: this.windowIdx });
    };
    
    this.getTabs_dualProcess = function(callback) {
        // Get all the windows with tabs synchronously. Then get the
        // image info for each tab asynchronously, knit everything
        // together, and send the result back via the callback.
        var openWindows = this.wmService.getEnumerator("navigator:browser");
        var windowIdx = -1;
        this.tabGetters = [];
        this.tabGetterCallback = callback;
        this.processedTabs = {}; // hash "windowIdx-tabIdx : true"
        // Get the eligible windows 
        do {
            // There must be at least one window for an extension to run in
            var openWindow = openWindows.getNext();
            try {
                var tc = openWindow.getBrowser().tabContainer.childNodes;
            } catch(ex) {
                continue;
            }
            windowIdx += 1;
            this.dump("**** setup TabGetter(" + windowIdx + ")");
            this.tabGetters.push(new this.TabGetter(windowIdx, openWindow, tc));
        } while (openWindows.hasMoreElements());
        /***/
        this.callbackTimeoutId = setTimeout(function() {
                this.dump("**** Failed to continue getting tabs");
                callback({ tabs:[], windowInfo:[] });
                // Allow 2 seconds per window
            }.bind(this), 2000 * this.tabGetters.length);
        for (var i = 0; i < this.tabGetters.length; i++ ) {
            this.tabGetters[i].setImageSetting(0);
        }
        /****/
        /****
        var doSetImage = function(this_, i) {
            this_.tabGetters[i].setImageSetting(0);
            if (i + 1 < this_.tabGetters.length) {
                setTimeout(function() {
                        doSetImage(this_, i + 1);
                    }, 30000);
            }
        }
        doSetImage(this, 0);
        ****/
    };
    
    this.getTabTitleAndURL = function(tab) {
        var s = tab.label;
        try {
            s += " - " + tab.location;
        } catch(ex) {}
        return s;
    }
    
    this.compareByName = function(tab1, tab2) {
        return (tab1.label_lc < tab2.label_lc
                ? -1 : (tab1.label_lc > tab2.label_lc ? 1 : 0));
    }
    
    this.launchDialog = function(event) {
        // Look for the window first
        const th_uri = 'chrome://tabhunter/content/selectTabDialog.xul';
        var openWindows = this.wmService.getEnumerator(null);
        do {
            var win = openWindows.getNext();
            if (win.location == th_uri) {
                win.focus();
                var pf = win.document.getElementById('pattern');
                pf.focus();
                pf.select();
                return;
            }
        } while(openWindows.hasMoreElements());
        var features = 'chrome,titlebar,resizable=yes,minimizable=yes,close=yes,dialog=no';
        if (this.isLinux()) {
            // workaround bug http://code.google.com/p/tabhunter/issues/detail?id=12
            // which is based on https://bugzilla.mozilla.org/show_bug.cgi?id=445674
            // other platforms, rely on the moz persist mechanism
            var x, y, props = {};
            if (event && event.type == 'click') {
                props.screenX = event.screenX - 250;
                props.screenY = event.screenY - 400;
            } else {
                props = { screenX:null, screenY:null}
            }
            var prefs = (Components.classes['@mozilla.org/preferences-service;1']
                  .getService(Components.interfaces.nsIPrefService)
                  .getBranch('extensions.tabhunter.'));
            for (var p in props) {
                try {
                    var val = prefs.getIntPref(p);
                    props[p] = val;
                } catch(ex) {
                    // Nothing interesting to report -- either
                    // it's the first time in, and the pref doesn't exist
                    // or someone's been messing with it
                }
            }
            for (var p in props) {
                if (props[p] != null) {
                    features += "," + p + "=" + props[p];
                }
            }
        }
        window.openDialog(th_uri,
                          'tabhunterEx',
                          features,
                          this);
    };
        
    this.dump = function(aMessage) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"]
                                       .getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage("tabhunter: " + aMessage);
    };
    
    this.isLinux = function() {
        return navigator.platform.search(/linux/i) > -1;
    };
    
    var this_ = this;
    this.keypressWrapper = function(event) {
        return this_.keypressHandler(event);
    };

    this.keypressHandler = function(event) {
        var ctrlKey = event.ctrlKey;
        var metaKey = event.metaKey;
        var keyCode = event.keyCode;
        if (!ctrlKey && !metaKey && !keyCode) {
            return;
        }
        var altKey = event.altKey;
        var shiftKey = event.shiftKey;
        var kbLaunchKey = this.prefs.getCharPref(this.kbLaunchNames.userKey);
        var launchIsKeyCode = this.prefs.getBoolPref(this.kbLaunchNames.userIsKeyCode);
        var charCode = event.charCode;
        if ((!!charCode) == launchIsKeyCode) {
            return;
        }
        if (charCode) {
            charCode = String.fromCharCode(charCode).toUpperCase();
            if (charCode != kbLaunchKey) {
                return;
            }
        } else if (event.keyCode != kbLaunchKey) {
            return;
        }
        var kbLaunchModifiers = this.prefs.getCharPref(this.kbLaunchNames.userModifiers); 
        if (!!ctrlKey == (kbLaunchModifiers.indexOf('control') == -1)) {
            return;
        }
        if (!!metaKey == (kbLaunchModifiers.indexOf('meta') == -1)) {
            return;
        }
        if (!!altKey == (kbLaunchModifiers.indexOf('alt') == -1)) {
            return;
        }
        if (!!shiftKey == (kbLaunchModifiers.indexOf('shift') == -1)) {
            return;
        }
        // If we're here launch the  dude.
        this.launchDialog(null);
        
    };

    this.onload = function() {
        if (document.documentElement.getAttribute('windowtype') != 'navigator:browser') {
            return;
        }        
        this.prefs = (Components.classes['@mozilla.org/preferences-service;1']
                      .getService(Components.interfaces.nsIPrefService)
                      .getBranch('extensions.tabhunter.'));
        this.kbLaunchNames = {
            factoryKey: 'kb-launch-factory-key',
            factoryModifiers: 'kb-launch-factory-modifiers',
            factoryIsKeyCode: 'kb-launch-factory-isKeyCode',
            userKey: 'kb-launch-user-key',
            userModifiers: 'kb-launch-user-modifiers',
            userIsKeyCode: 'kb-launch-user-isKeyCode'
        }
        var kbLaunchModifiers = (window.navigator.platform.search("Mac") == 0
                                 ? "meta control"
                                 : "control alt");
        var kbLaunchKey = "T";
        if (!this.prefs.prefHasUserValue(this.kbLaunchNames.factoryKey)) {
            this.prefs.setCharPref(this.kbLaunchNames.factoryKey, kbLaunchKey);
            this.prefs.setCharPref(this.kbLaunchNames.factoryModifiers, kbLaunchModifiers);
        }
        if (!this.prefs.prefHasUserValue(this.kbLaunchNames.userKey)) {
            this.prefs.setCharPref(this.kbLaunchNames.userKey, kbLaunchKey);
            this.prefs.setCharPref(this.kbLaunchNames.userModifiers, kbLaunchModifiers);
        }
        // patch - yikes
        if (!this.prefs.prefHasUserValue(this.kbLaunchNames.factoryIsKeyCode)) {
            this.prefs.setBoolPref(this.kbLaunchNames.factoryIsKeyCode, false);
        }
        if (!this.prefs.prefHasUserValue(this.kbLaunchNames.userIsKeyCode)) {
            this.prefs.setBoolPref(this.kbLaunchNames.userIsKeyCode, false);
        }
        // wait 5 seconds -- on the mac the status bar icon isn't always present yet.
         setTimeout(function(prefs, self, document) {
            var showStatusBarIcon = prefs.getBoolPref('showStatusBarIcon');
            var showMenuItem = prefs.getBoolPref('showMenuItem');
            document.getElementById("th-status-image").collapsed = !showStatusBarIcon;
            document.getElementById("menuitem_EPExt_TabhunterLaunch").hidden = !showMenuItem;
            document.addEventListener('keypress', self.keypressWrapper, false);
     }, 500, this.prefs, this, window.document);
    };

    this.onunload = function() {
        document.removeEventListener('keypress', this.keypressWrapper, false);
    };

    this.doCommand = function(event) {
        switch(event.button) {
        case 0: 
            this.launchDialog(event);
            break;
        case 2:
            event.preventDefault();
            this.showPreferences();
            break;
        }
    };
    
    this.showPreferences = function(event) {
        var features = 'chrome,titlebar,toolbar=no,close=yes,dialog=no';
        window.openDialog('chrome://tabhunter/content/prefs.xul',
                          'TabhunterPrefs',
                          features);
    };
    
}).apply(ep_extensions.tabhunter);

window.addEventListener("load", 
        function(e) { 
                ep_extensions.tabhunter.onload(e); },
        false);
window.addEventListener("unload",
        function(e) { 
                ep_extensions.tabhunter.onunload(e); },
        false);
}catch(e) {
        var consoleService = Components.classes["@mozilla.org/consoleservice;1"]
                                       .getService(Components.interfaces.nsIConsoleService);
        consoleService.logStringMessage("tabhunter startup: " + e);
        consoleService.logStringMessage("th failure stack: " + e.stack);
}
