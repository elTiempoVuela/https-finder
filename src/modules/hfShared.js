var EXPORTED_SYMBOLS = ['results',
'popupNotify',
'removeNotification',
'openWebsiteInTab',
'sharedWriteRule',
'getHostWithoutSub',
'restartNow',
'alertRuleFinished'];

var results = {
    goodSSL : [],
    permWhitelistLength : 0,
    whitelist : [],
    tempNoAlerts : []
};

var redirectedTab =  [[]]; //Tab info for pre-redirect URLs.


//Generic notifier method
function popupNotify(title,body){
    try{
        var alertsService = Components.classes["@mozilla.org/alerts-service;1"]
        .getService(Components.interfaces.nsIAlertsService);
        alertsService.showAlertNotification("chrome://httpsfinder/skin/httpRedirect.png",
            title, body, false, "", null);
    }
    catch(e){ /*Do nothing*/ }
};

function openWebsiteInTab(addr){
    if(typeof gBrowser == "undefined"){
        var window = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator);
        var browserWindow = window.getMostRecentWindow("navigator:browser").getBrowser();
        var newTab = browserWindow.addTab(addr, null, null);
        browserWindow.selectedTab = newTab;

    }
    else
        gBrowser.selectedTab = gBrowser.addTab(addr);
};

//Remove notification called from setTimeout(). Looks through each tab for an alert with mataching key. Removes it, if exists.
function removeNotification(key){
    var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"]
    .getService(Components.interfaces.nsIWindowMediator);

    var currentWindow = windowMediator.getMostRecentWindow("navigator:browser");    

    var browser = currentWindow.gBrowser.selectedBrowser;
    var item = null;
    if (item = currentWindow.getBrowser().getNotificationBox(browser).getNotificationWithValue(key))
        currentWindow.getBrowser().getNotificationBox(browser).removeNotification(item);
};

/*
 * Code below this point is for rule writing
 */

//Passed in uri variable is an asciispec uri from pre-redirect. (i.e. full http://www.domain.com)
function sharedWriteRule(hostname, topLevel){       
    var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"]
    .getService(Components.interfaces.nsIWindowMediator);

    var prefService = Components.classes["@mozilla.org/preferences-service;1"]
    .getService(Components.interfaces.nsIPrefService);

    var prefs = prefService.getBranch("extensions.httpsfinder.");
    var currentWindow = windowMediator.getMostRecentWindow("navigator:browser");
    var strings = currentWindow.document.getElementById("httpsfinderStrings");

    var title = "";
    var tldLength = topLevel.length - 1;
    if(hostname.indexOf("www.") != -1)
        title = hostname.slice(hostname.indexOf(".",0) + 1,hostname.lastIndexOf(".",0) - tldLength);
    else
        title = hostname.slice(0, hostname.lastIndexOf(".", 0) - tldLength);
    title = title.charAt(0).toUpperCase() + title.slice(1);


    var from = "^http://(www\\.)?" + title.toLowerCase() + "\\"  + topLevel + "/";
    var to = "https://" + title.toLowerCase() + topLevel + "/";
    var rule;
    var versionTag = "\n<!-- Rule generated by HTTPS Finder " + strings.getString("httpsfinder.version") + " -->";

    //Check hostname for "www.".
    //One will be "domain.com" and the other will be "www.domain.com"
    var domains = hostname.split(".");
    if(domains.length == 2){
        //Then the hostname is of the form "mysite.com". We add a "www." rule as well in this case.
        var wwwHost =  "www." + hostname;
        to = "https://" + hostname + "/";
        rule = <{"ruleset"} name = {title}>
        <{"target"} host={hostname}/>
        <{"target"} host={wwwHost}/>
        <{"rule"} from={from} to={to}/>
        </{'ruleset'}>;
    }
    else if(domains.length == 3){
        //Then the hostname already contains subdomain info (www or non-www).
        //Don't touch it.
        to = "https://" + hostname + "/";
        rule = <{"ruleset"} name = {title}>
        <{"target"} host={hostname}/>
        <{'rule'} from={from} to={to}/>
        </{"ruleset"}>;
    }
    else
        //Catch all
        rule = <{"ruleset"} name = {title}>
        <{"target"} host={hostname}/>
        <{"rule"} from={from} to={to}/>
        </{"ruleset"}>;

    if(rule)
        rule = rule.toXMLString();

    if(prefs.getBoolPref("showrulepreview")){
        var params = {
            inn:{
                rule:rule
            },
            out:null
        };

        //Workaround for how OS X handles modal dialog windows.. If launched from Preferences, it won't show
        //the dialog until prefwindow closes. So we just make the rule preview non-modal here.
        
        // Returns "WINNT" on Windows,"Linux" on GNU/Linux. and "Darwin" on Mac OS X.
        var osString = Components.classes["@mozilla.org/xre/app-info;1"]
        .getService(Components.interfaces.nsIXULRuntime).OS;

        if(osString == "Darwin")
            currentWindow.openDialog("chrome://httpsfinder/content/rulePreview.xul", "",
                "chrome, dialog, centerscreen, resizable=yes", params).focus();
        else
            currentWindow.openDialog("chrome://httpsfinder/content/rulePreview.xul", "",
                "chrome, dialog, modal,centerscreen, resizable=yes", params).focus();

        if (!params.out)
            return; //user canceled rule
        else
            rule = params.out.rule; //reassign rule value from the textbox

          //Reconstruct E4X object from user input to insure it's valid XML
        rule =  new XML(rule);

        title = rule.@name; //Re-grab the title from XML for file name (user may have edited it)
    }

    var ostream = Components.classes["@mozilla.org/network/file-output-stream;1"].
    createInstance(Components.interfaces.nsIFileOutputStream);
    var file = Components.classes["@mozilla.org/file/directory_service;1"].
    getService(Components.interfaces.nsIProperties).
    get("ProfD", Components.interfaces.nsIFile);
    file.append("HTTPSEverywhereUserRules")
    file.append(title + ".xml");
    try{
        file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0666);
    }
    catch(e){
        if(e.name == 'NS_ERROR_FILE_ALREADY_EXISTS')
            file.remove(false);   
    }
    ostream.init(file, 0x02 | 0x08 | 0x20, 0666, ostream.DEFER_OPEN);
    var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
    createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
    converter.charset = "UTF-8";
    var istream = converter.convertToInputStream(rule + versionTag);
    Components.utils.import("resource://gre/modules/NetUtil.jsm");
    NetUtil.asyncCopy(istream, ostream);

    if(this.results.tempNoAlerts.indexOf(hostname) == -1)
        this.results.tempNoAlerts.push(hostname);

    alertRuleFinished(currentWindow.gBrowser.contentDocument);
};

//return host without subdomain (e.g. input: code.google.com, outpout: google.com)
function getHostWithoutSub(fullHost){
    if(typeof fullHost != 'string')
        return "";
    else
        return fullHost.slice(fullHost.indexOf(".") + 1, fullHost.length);
};

function restartNow(){
    var Application = Components.classes["@mozilla.org/fuel/application;1"].getService(Components.interfaces.fuelIApplication);
    Application.restart();
};

function alertRuleFinished(aDocument){ 
    //Check firefox version and use appropriate method
    var Application = Components.classes["@mozilla.org/fuel/application;1"]
    .getService(Components.interfaces.fuelIApplication);
    var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"]
    .getService(Components.interfaces.nsIWindowMediator);
    var prefService = Components.classes["@mozilla.org/preferences-service;1"]
    .getService(Components.interfaces.nsIPrefService);

    var currentWindow = windowMediator.getMostRecentWindow("navigator:browser");
    var strings = currentWindow.document.getElementById("httpsfinderStrings");
    var prefs = prefService.getBranch("extensions.httpsfinder.");

    var removeNotification = this.removeNotification;

    //Determin FF version and use proper method to check for HTTPS Everywhere
    if(Application.version.charAt(0) >= 4){
        Components.utils.import("resource://gre/modules/AddonManager.jsm");
        AddonManager.getAddonByID("https-everywhere@eff.org", function(addon) {
            //Addon is null if not installed
            if(addon == null)
                getHTTPSEverywhere();
            else if(addon != null)
                promptForRestart();
        });
    }
    else{  //Firefox versions below 4.0
        if(!Application.extensions.has("https-everywhere@eff.org"))
            getHTTPSEverywhere();
        else
            promptForRestart();
    }

    //Alert user to install HTTPS Everywhere for rule enforcement
    var getHTTPSEverywhere = function() {
        var installButtons = [{
            label: strings.getString("httpsfinder.main.getHttpsEverywhere"),
            accessKey: strings.getString("httpsfinder.main.getHttpsEverywhereKey"),
            popup: null,
            callback: getHE  //Why is this needed? Setting the callback directly automatically calls when there is a parameter
        }];
       
        var nb = currentWindow.gBrowser.getNotificationBox(currentWindow.gBrowser.getBrowserForDocument(aDocument));
        nb.appendNotification(strings.getString("httpsfinder.main.NoHttpsEverywhere"),
            'httpsfinder-getHE','chrome://httpsfinder/skin/httpsAvailable.png',
            nb.PRIORITY_INFO_HIGH, installButtons);
    };

    //See previous comment (in installButtons)
    var getHE = function(){
        this.openWebsiteInTab("http://www.eff.org/https-everywhere/");
    };

    //HTTPS Everywhere is installed. Prompt for restart
    var promptForRestart = function() {
        var nb = currentWindow.gBrowser.getNotificationBox(currentWindow.gBrowser.getBrowserForDocument(aDocument));
        var pbs = Components.classes["@mozilla.org/privatebrowsing;1"]
        .getService(Components.interfaces.nsIPrivateBrowsingService);

        var restartButtons = [{
            label: strings.getString("httpsfinder.main.restartYes"),
            accessKey: strings.getString("httpsfinder.main.restartYesKey"),
            popup: null,
            callback: restartNow
        }];

        if (pbs.privateBrowsingEnabled)
            nb.appendNotification(strings.getString("httpsfinder.main.restartPromptPrivate"),
                "httpsfinder-restart",'chrome://httpsfinder/skin/httpsAvailable.png',
                nb.PRIORITY_INFO_HIGH, restartButtons);
        else
            nb.appendNotification(strings.getString("httpsfinder.main.restartPrompt"),
                "httpsfinder-restart",'chrome://httpsfinder/skin/httpsAvailable.png',
                nb.PRIORITY_INFO_HIGH, restartButtons);

        if(prefs.getBoolPref("dismissAlerts"))
            currentWindow.setTimeout(function(){
                removeNotification("httpsfinder-restart")
            },prefs.getIntPref("alertDismissTime") * 1000, 'httpsfinder-restart');
    };
};

