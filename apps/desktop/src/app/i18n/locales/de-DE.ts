export default {
  common: {
    manageWithPine: "Mit Pine verwalten",
    back: "Zurück",
    downloadFile: "Datei herunterladen",
    cancel: "Abbrechen",
    delete: "Löschen",
    edit: "Bearbeiten",
    done: "Fertig",
    help: "Hilfe",
    save: "Speichern",
    saving: "Wird gespeichert",
  },
  intelligentUi: {
    sendUnavailable: "Diese Antwort kann hier keine Nachrichten senden.",
  },
  markdown: {
    copyCode: "Code kopieren",
    copyCodeFailed: "Code konnte nicht kopiert werden",
    imageLoadFailed: "Bild konnte nicht geladen werden",
    externalLinkTitle: "Externen Link öffnen?",
    externalLinkDescription:
      "Nach der Bestätigung wird diese URL in Ihrem Standardbrowser geöffnet:",
    openExternalLink: "Link öffnen",
    externalLinkOpenFailed: "Der Link konnte nicht im Browser geöffnet werden.",
    imageViewer: {
      open: "{name} vergrößert anzeigen",
      untitled: "Bild",
      description:
        "Vergrößertes Bild. Mit den Zoomsteuerungen zoomen, mit den Pfeiltasten zwischen Bildern wechseln.",
      controls: "Bildsteuerung",
      previous: "Vorheriges Bild",
      next: "Nächstes Bild",
      position: "{index} / {count}",
      fit: "An Fenster anpassen",
    },
  },
  updater: {
    available: "Neue Pine-Version verfügbar",
    title: "Pine aktualisieren?",
    description:
      "Pine {version} ist verfügbar. Sehen Sie sich die Änderungen vor dem Update an.",
    download: "Update herunterladen",
    downloading: "Update wird heruntergeladen",
    ready:
      "Das Update ist bereit. Pine startet neu, um die Installation abzuschließen.",
    restart: "Neu starten und installieren",
    installing: "Installationsprogramm wird gestartet",
    later: "Später",
    failed: "Das Update konnte nicht installiert werden.",
  },
  preferences: {
    remoteControl: {
      browserAccess: "Browserzugriff",
      browserAccessDescription:
        "Pine im Browser verwenden. Pine muss dafür weiterlaufen.",
      browserAccessNeedsPassword:
        "Legen Sie ein Zugriffspasswort fest, um dies zu aktivieren.",
      browserAccessRunning: "Läuft unter {address}.",
      password: "Zugriffspasswort",
      passwordSet: "Browser melden sich mit diesem Passwort an.",
      passwordNotSet: "Noch kein Passwort festgelegt.",
      setPassword: "Passwort festlegen",
      changePassword: "Passwort ändern",
      passwordDialogDescription:
        "Jeder, der dieses Passwort kennt, kann Pine über einen Browser steuern. Verwenden Sie daher ein Passwort, das Sie nirgendwo sonst nutzen.",
      newPassword: "Neues Passwort",
      confirmPassword: "Passwort bestätigen",
      passwordTooShort: "Verwenden Sie mindestens {min} Zeichen.",
      passwordMismatch: "Die Passwörter stimmen nicht überein.",
      changePasswordSignsOut:
        "Durch die Änderung werden alle Browser abgemeldet.",
      passwordSaved: "Zugriffspasswort gespeichert",
      requirePassword: "Passwort verlangen",
      requirePasswordDescription:
        "Browser müssen das Zugriffspasswort eingeben, bevor sie Pine nutzen können.",
      requirePasswordOff:
        "Aus. Jeder, der diese Adresse erreichen kann, steuert Pine ohne Anmeldung.",
      disablePasswordTitle: "Passwort ausschalten?",
      disablePasswordDescription:
        "Tun Sie dies nur, wenn bereits etwas vor Pine, etwa Cloudflare Access, die Anmeldung übernimmt.",
      disablePasswordRiskControl:
        "Jeder, der die Adresse von Pine erreicht, kann Ihre Projekte lesen, Agenten ausführen und Befehle auf diesem Computer ausführen.",
      disablePasswordRiskLocal:
        "Jedes Programm und jeder Benutzer auf diesem Computer kann 127.0.0.1 öffnen und dasselbe tun.",
      disablePasswordRiskLan:
        "Bei aktiviertem LAN-Zugriff kann jedes Gerät im selben Netzwerk dasselbe tun.",
      disablePasswordAction: "Passwort ausschalten",
      rememberFor: "Angemeldet bleiben",
      rememberForDescription:
        "Wie lange ein Browser nach Eingabe des Passworts angemeldet bleibt.",
      remember: {
        session: "Bis der Browser geschlossen wird",
        "1d": "1 Tag",
        "7d": "7 Tage",
        "30d": "30 Tage",
      },
      lan: "LAN-Zugriff erlauben",
      lanDescription:
        "Andere Geräte in Ihrem Netzwerk können Pine öffnen. Der Datenverkehr läuft über unverschlüsseltes HTTP, nutzen Sie daher nur vertrauenswürdige Netzwerke.",
      lanWithoutPassword:
        "Das Passwort ist deaktiviert: Sobald dies aktiv ist, kann jedes Gerät im selben Netzwerk Pine ohne Anmeldung steuern und Befehle auf diesem Computer ausführen.",
      publicOrigin: "Öffentliche Adresse",
      publicOriginDescription:
        "Wenn ein Reverse-Proxy oder Tunnel wie Cloudflare Tunnel Pine bereitstellt, geben Sie dessen Adresse ein.",
      invalidPublicOrigin:
        "Geben Sie eine Adresse wie https://pine.example.com ohne Pfad ein.",
      port: "Port",
      portDescription:
        "Öffnen Sie nach einer Änderung den Zugriffslink erneut.",
      invalidPort: "Verwenden Sie einen Port von {min} bis {max}.",
      accessLink: "Zugriffslink",
      accessLinkDescription: "Öffnet Pine auf diesem Computer unter 127.0.0.1.",
      copyLink: "Link kopieren",
      linkCopied: "Zugriffslink kopiert",
      open: "Im Browser öffnen",
      signOut: "Angemeldete Browser",
      signOutDescription: "Jeder Browser muss das Passwort erneut eingeben.",
      signOutAction: "Alle abmelden",
      signedOut: "Alle Browser abgemeldet",
    },
    relayRemote: {
      title: "Fernsteuerung über {brand}",
      description:
        "Koppeln Sie beliebige Geräte per QR-Code oder Link. Ohne Portweiterleitung und Ende-zu-Ende-verschlüsselt.",
      needsWebAccess:
        "Andere Geräte verbinden sich über den Browserzugriff. Aktivieren Sie zuerst unten „Browserzugriff“.",
      pair: "Gerät koppeln",
      pairTitle: "Gerät koppeln",
      pairDescription:
        "Scannen Sie den Code mit der Kamera des Geräts oder öffnen Sie den Kopplungslink in dessen Browser. Dieser Computer bittet Sie dann um Bestätigung.",
      pairBrowserHint:
        "Verwende für die Fernsteuerung möglichst den QR-Scanner des Systems (meist die Kamera) und den nativen Browser. Wenn Pine Remote auf deinem Home-Bildschirm liegt, scanne in dieser App, um den Computer dort zu speichern.",
      pairExpires: "Code und Link laufen in {time} ab.",
      pairExpired: "Der Code ist abgelaufen.",
      pairAgain: "Neuer Code",
      fingerprint: "Fingerabdruck dieses Computers: {fingerprint}",
      pairLink: "Kopplungslink",
      copyPairLink: "Kopplungslink kopieren",
      pairLinkCopied: "Kopplungslink kopiert",
      devices: "Gekoppelte Geräte",
      noDevices: "Noch keine Geräte gekoppelt.",
      online: "Online",
      pairedAt: "Gekoppelt am {date}",
      lastSeenAt: "Zuletzt verbunden {date}",
      rename: "Umbenennen",
      renameTitle: "Gerät umbenennen",
      deviceName: "Name",
      remove: "Entfernen",
      removeTitle: "„{name}“ entfernen?",
      removeDescription:
        "Dieses Gerät wird sofort getrennt und muss erneut gekoppelt werden, um sich wieder zu verbinden.",
    },
    wechatRemote: {
      title: "WeChat",
      experimental: "Experimentell",
      description:
        "Sende Pine Aufgaben aus deinem eigenen WeChat über Tencents ClawBot. Es kann aufhören zu funktionieren, wenn Tencent seine Richtlinien ändert.",
      notConnected: "Kein WeChat-Konto verbunden.",
      connect: "WeChat verbinden",
      connectTitle: "WeChat verbinden",
      phaseStarting: "Code wird abgerufen…",
      phaseQr: "Scanne den Code mit WeChat auf deinem Handy.",
      phaseScanned: "Gescannt. Bestätige auf deinem Handy.",
      phaseVerifyCode:
        "Gib den Bestätigungscode ein, den WeChat auf deinem Handy zeigt.",
      phaseConfirming: "Wird bestätigt…",
      verifyCode: "Bestätigungscode",
      verifyRetry: "Der Code wurde nicht akzeptiert. Versuche es erneut.",
      submit: "Senden",
      pairingInstructions:
        "Sende dem Bot in WeChat eine beliebige Nachricht (ein einzelner Punkt genügt). Er antwortet mit einem 6-stelligen Code. Gib ihn hier ein.",
      pairingCode: "6-stelliger Code",
      pairingWaiting: "Warte auf deine Nachricht in WeChat…",
      pairingSent: "Der Code wurde an WeChat gesendet.",
      attemptsLeft: "Verbleibende Versuche: {count}",
      expires: "Läuft in {time} ab.",
      expired: "Der Code ist abgelaufen.",
      tryAgain: "Erneut versuchen",
      account: "WeChat-Konto {digest}",
      connectedAt: "Verbunden {date}",
      statusOnline: "Online",
      statusConnecting: "Verbindet",
      statusRetrying: "Neuer Versuch",
      statusReauth: "Erneut scannen nötig",
      statusPaused: "Pausiert",
      receive: "Aufgaben aus WeChat empfangen",
      receiveDescription:
        "Solange dies aus ist, ignoriert Pine Nachrichten aus WeChat. Nur dieser Computer kann es wieder einschalten.",
      scanAgain: "Erneut scannen",
      disconnect: "Trennen",
      disconnectTitle: "WeChat trennen?",
      disconnectDescription:
        "Sitzungen, die nur WeChat hält, werden beendet, und die WeChat-Berechtigungen kehren zu ihren Standardwerten zurück.",
      defaultProject: "Standardprojekt",
      defaultProjectDescription: "Hier beginnt eine neue Sitzung aus WeChat.",
      ceiling: "Höchster Freigabemodus",
      ceilingDescription:
        "Aus WeChat gesteuerte Sitzungen laufen nie mit weniger Aufsicht als hier eingestellt.",
      yoloWarning:
        "Mit YOLO steuert jeder, der in dein WeChat-Konto gelangt, diesen Computer.",
      defaultMode: "Standard-Freigabemodus",
      defaultModeDescription:
        "Der Modus von Sitzungen, die aus WeChat gestartet werden.",
      allowHighRisk: "Freigabe riskanter Aktionen aus WeChat erlauben",
      allowHighRiskDescription:
        "Native Ausführung außerhalb der Sandbox und zerstörerische Befehle. Aus: Sie können nur auf diesem Computer freigegeben werden.",
      allowFiles: "Senden von Dateien an WeChat erlauben",
      allowFilesDescription:
        "Nur Dateien, die der Agent präsentiert hat, bis 100 MB pro Datei. Dateien laufen über Tencents Server.",
      keepAwake: "Computer wach halten, solange WeChat an ist",
      keepAwakeDescription:
        "Ein geschlossener Deckel versetzt den Computer trotzdem in den Ruhezustand.",
      notes: "Gut zu wissen",
      noteRunning:
        "Funktioniert nur, solange Pine läuft und der Computer wach ist.",
      noteTencent: "Nachrichten laufen über Tencents Server.",
      noteReadScope:
        "Das verbundene Konto kann Sitzungstitel, Suchergebnisse und Antworten aller Projekte lesen.",
      noteNetwork:
        "Ein Proxy oder ein Netzwerkausgang im Ausland kann blockiert werden.",
      noteOneComputer: "Ein WeChat-Konto verbindet sich mit einem Computer.",
      noteHelp:
        "Sende in WeChat .help (oder .?), um die Befehle zu sehen. Normaler Text geht an die aktuelle Sitzung.",
      noteStale:
        "Aufgaben, die Pine erst mehr als 10 Minuten nach dem Senden erreichen, warten, bis du sie in WeChat bestätigst.",
      serverGuide: "Pine auf einem Server ausführen",
      error: {
        encryptionUnavailable:
          "Dieser Computer kann die WeChat-Zugangsdaten nicht sicher speichern, daher lässt sich WeChat nicht verbinden.",
        bindingExpired:
          "Der Code ist vor der Bestätigung abgelaufen. Versuche es erneut.",
        bindingBlocked:
          "Tencent hat die Verbindung abgelehnt. Versuche es später erneut.",
        pairingFailed:
          "Der Kopplungscode wurde nicht bestätigt. Verbinde erneut, um neu zu beginnen.",
        bindingFailed:
          "WeChat konnte nicht verbunden werden. Versuche es erneut.",
        accountMismatch:
          "Ein anderes WeChat-Konto hat den Code gescannt. Trenne zuerst, um ein anderes Konto zu verbinden.",
        network:
          "Tencents Server sind nicht erreichbar. Prüfe das Netzwerk oder den Proxy.",
        settingsReset:
          "Die WeChat-Einstellungen konnten nicht gelesen werden und wurden zurückgesetzt. WeChat-Fernsteuerung ist pausiert.",
      },
    },
    projectManagement: {
      title: "Projekte",
      description:
        "Verwalten Sie alle Projekte und die Daten, die Pine dafür in seinem Datenverzeichnis ablegt. Die Projektordner selbst werden nie verändert.",
      create: "Neues Projekt",
      edit: "Bearbeiten",
      actions: "Aktionen für {name}",
      loading: "Nutzung wird ermittelt…",
      sessions: "Sitzungen {size}",
      attachments: "Anhänge {size}",
      temporary: "Temporäre Dateien {size}",
      cache: "Suchcache {size}",
      clearTemporary: "Temporäre Dateien löschen",
      clearAttachments: "Anhänge löschen…",
      cleared: "{size} freigegeben",
      clearFailed: "Die Daten konnten nicht gelöscht werden",
      loadFailed: "Die Datennutzung konnte nicht ermittelt werden",
      clearAttachmentsTitle: "Anhänge von „{name}“ löschen?",
      clearAttachmentsDescription:
        "Eingefügte Bilder und lange Texte ({size}) werden gelöscht. Frühere Nachrichten, die darauf verweisen, können diese Anhänge nicht mehr in der Vorschau anzeigen.",
      clearAttachmentsAction: "Anhänge löschen",
    },
    title: "Pine-Einstellungen",
    description:
      "Legen Sie fest, wie Pine aussieht, welche Modelle es nutzt und wie es mit Ihnen zusammenarbeitet.",
    open: "Pine-Einstellungen öffnen",
    sections: {
      general: "Allgemein",
      appearance: "Darstellung",
      models: "Modelle",
      agent: "Agent",
      personalization: "Benutzerprofil",
      projects: "Projekte",
      remote: "Fernsteuerung",
    },
    groups: {
      language: "Oberfläche",
      notifications: "Benachrichtigungen",
      system: "System",
      theme: "Design",
      reading: "Lesen",
      modelCatalog: "Modellkatalog",
      modelRoles: "Spezialisierte Modelle",
      permissions: "Berechtigungen",
      context: "Kontext",
      tools: "Werkzeuge und Datenschutz",
    },
    sectionsLabel: "Einstellungsbereiche",
    language: "Sprache",
    currency: "Währung",
    currencyAuto: "System folgen ({currency})",
    currencyDescription:
      "Für die Anzeige von Gesprächskosten und Kostenlimits, umgerechnet zum Tageskurs der EZB. Ohne Kurse werden US-Dollar angezeigt.",
    appearance: "Farbmodus",
    themeSystem: "System",
    themeLight: "Hell",
    themeDark: "Dunkel",
    defaultColorTheme: "Standard-Farbdesign von Pine",
    defaultColorThemeDescription:
      "Wird als Standarddesign verwendet; die Akzentfarben der Projekte haben Vorrang.",
    quickComposer: "Schnelleingabe",
    quickComposerDescription:
      "Drücken Sie {shortcut} in einer beliebigen App, um aus einem schwebenden Eingabefeld eine neue Unterhaltung zu starten.",
    runInBackground: "Im Hintergrund weiterlaufen",
    runInBackgroundDescriptionMac:
      "Wenn Sie das letzte Fenster schließen, bleibt Pine in der Menüleiste, sodass Fernsteuerung und Schnelleingabe verfügbar bleiben. Beenden Sie Pine über das Menüleistensymbol.",
    runInBackgroundDescriptionWindows:
      "Wenn Sie das letzte Fenster schließen, bleibt Pine im Infobereich, sodass Fernsteuerung und Schnelleingabe verfügbar bleiben. Beenden Sie Pine über das Symbol im Infobereich.",
    approximateLocation: "Ungefähren Standort mit der KI teilen",
    approximateLocationDescription:
      "Ermittelt die öffentliche IP-Adresse dieses Computers über Cloudflare und schätzt Ihre Stadt auf diesem Gerät mit der in Pine integrierten GeoIP-Datenbank (IP Geolocation by DB-IP). Nur Stadt, Region und Land gelangen zur KI. Ein VPN oder Proxy kann den Standort ungenau machen.",
    completionSignal: "Signal bei Abschluss der Arbeit",
    completionSignalOff: "Aus",
    completionSignalNotification: "Benachrichtigung",
    completionSignalNotificationSound: "Benachrichtigung und Ton",
    attentionNotifications: "Bei Freigaben und Fragen benachrichtigen",
    attentionNotificationsDescription:
      "Zeigt eine Systembenachrichtigung an, wenn Pine im Hintergrund läuft und ein Werkzeugaufruf freigegeben werden muss oder Pine Ihnen eine Frage stellt. Freigabe-Benachrichtigungen haben die Schaltflächen „Genehmigen“ und „Ablehnen“.",
    diagnosticLogging: "Diagnoseprotokollierung",
    diagnosticLoggingHelp: "Über die Diagnoseprotokollierung",
    diagnosticLoggingDescription:
      "Zeichnet lokal Fehler und Ereignisse bei der Wiederherstellung nach dem Ruhezustand auf, um die Fehlersuche zu erleichtern. Die beiden neuesten Protokolle werden aufbewahrt, insgesamt höchstens etwa 2 MB. Unterhaltungstexte sind ausgeschlossen, und Protokolle werden nie automatisch hochgeladen. Beim Ausschalten wird die Aufzeichnung gestoppt, vorhandene Protokolle bleiben erhalten.",
    contextCompactionStrategy: "Strategie zur Kontextverdichtung",
    contextCompactionStrategyHelp: "Über die Strategie zur Kontextverdichtung",
    contextCompactionStrategyDescription:
      "Die empfohlenen Einstellungen verdichten bei 80 % Kontextauslastung, begrenzt auf 400 K Token.",
    contextCompactionPassive: "Passive Verdichtung",
    contextCompactionRecommended: "Empfohlene Einstellungen verwenden",
    contextCompactionRoute: "Methode der Kontextverdichtung",
    contextCompactionRouteHelp: "Über die Methoden der Kontextverdichtung",
    contextCompactionRouteDescription:
      "„Modell“ lässt das aktuelle Modell die Zusammenfassung schreiben. Der „Semantische Algorithmus“ ruft kein Modell auf: Er extrahiert Ziele, Dateiänderungen, Commits und ein kurzes Protokoll aus der Unterhaltung, sodass die Verdichtung schneller ist und keine Token verbraucht.",
    contextCompactionRouteModel: "Modell",
    contextCompactionRouteSemantic: "Semantischer Algorithmus (Beta)",
    monetMode: "Monet",
    invertDocuments: "Dokumente im Dunkelmodus invertieren",
    invertDocumentsDescription:
      "Öffnet PDFs, Präsentationen und andere Dokumente im Dunkelmodus mit invertierten Seiten",
    sidebarVibrancy: "Natives Seitenleistenmaterial",
    sidebarVibrancyDescription:
      "Stellt die Seitenleiste mit dem nativen macOS-Seitenleistenmaterial dar",
    modelCatalogRefresh: "Modellkataloge",
    modelCatalogRefreshDescription:
      "Ruft die neuesten Modelllisten der eingerichteten Anbieter ab.",
    modelCatalogRefreshAction: "Jetzt aktualisieren",
    modelCatalogRefreshing: "Wird aktualisiert…",
    modelCatalogRefreshed: "Modellkataloge aktualisiert",
    autoApprovalStrategy: "Pfad der automatischen Freigabe",
    autoApprovalModel: "Prüfung durch ein Modell",
    autoApprovalDecisions: "Decisions-Modell (Beta)",
    autoApprovalModelDescription:
      "„Automatisch genehmigen“ und „Autonomes Arbeiten“ verwenden für jede Prüfung das Modell für Titelerzeugung und Prüfung.",
    autoApprovalDecisionsDescription:
      "Decisions sortiert zuerst vor: allow läuft direkt weiter, und needs_user öffnet eine Bestätigungskarte. Abgelehnte Aufrufe oder eine nicht verfügbare Vorsortierung gehen an das Modell für Titelerzeugung und Prüfung, das die endgültige Entscheidung samt Begründung trifft. „Autonomes Arbeiten“ fragt den Benutzer nicht.",
    decisionsModel: "Decisions-Vorsortiermodell",
    selectDecisionsModel: "Modell auswählen",
    autoApprovalHelp: "Über die Pfade der automatischen Freigabe",
    decisionsCredentialMissing:
      "OpenRouter ist nicht eingerichtet. Fügen Sie unter „Anbieter und Modelle verwalten“ Zugangsdaten hinzu; bis dahin wird die Prüfung durch ein Modell verwendet.",
    utilityModel: "Modell für Titelerzeugung",
    approvalModel: "Modell für Freigabeprüfung",
    selectUtilityModel: "Modell auswählen",
    noUtilityModelSelected: "Kein Modell ausgewählt",
    imageModel: "Modell für Bilderzeugung",
    selectImageModel: "Modell auswählen",
    noImageModelSelected: "Standardmodell",
    imageModelUnconfigured:
      "OpenRouter ist noch nicht eingerichtet. Fügen Sie über „Anbieter und Modelle verwalten“ den API-Schlüssel hinzu.",
    videoModel: "Modell für Videoerzeugung",
    selectVideoModel: "Modell auswählen",
    noVideoModelSelected: "Kein Modell ausgewählt",
    videoModelUnconfigured:
      "OpenRouter ist noch nicht eingerichtet. Fügen Sie über „Anbieter und Modelle verwalten“ den API-Schlüssel hinzu.",
    tinyFish: "TinyFish-Webwerkzeuge",
    tinyFishDescription:
      "Fügen Sie einen API-Schlüssel hinzu, damit die KI Websuche und Seitenabruf nutzen kann.",
    tinyFishConfigured: "Konfiguriert",
    tinyFishNotConfigured: "Nicht konfiguriert",
    tinyFishConfiguredDescription:
      "Die KI kann Websuche und Seitenabruf nutzen.",
    addTinyFishApiKey: "Schlüssel hinzufügen",
    changeTinyFishApiKey: "Schlüssel ändern",
    tinyFishDialogTitle: "TinyFish-API-Schlüssel festlegen",
    tinyFishApiKeyLabel: "API-Schlüssel",
    tinyFishApiKeyPlaceholder: "Geben Sie Ihren TinyFish-API-Schlüssel ein",
    saveTinyFishApiKey: "Schlüssel speichern",
    userProfileNicknameLabel: "Spitzname",
    userProfileNicknamePlaceholder: "Wie soll Pine Sie nennen?",
    userProfileNicknameDescription:
      "Pine verwendet diesen Namen, wenn es passt.",
    userProfilePronounsLabel: "Pronomen",
    userProfilePronounsUnspecified: "Keine Angabe",
    userProfilePronounsHe: "er/ihm",
    userProfilePronounsShe: "sie/ihr",
    userProfilePronounsThey: "they/them (neutral)",
    userProfilePronounsCustom: "Benutzerdefiniert",
    userProfilePronounsCustomLabel: "Eigene Pronomen",
    userProfilePronounsCustomPlaceholder: "Eigene Pronomen eingeben",
    userProfilePronounsDescription:
      "Pine verwendet diese Pronomen, wenn es in der dritten Person über Sie schreibt, zum Beispiel in Dokumenten oder Nachrichten, die es für Sie verfasst.",
    userProfileStyleLabel: "Kommunikationsstil",
    userProfileStyleCalm: "Ruhig und professionell",
    userProfileStyleNeutral: "Neutral",
    userProfileStyleWarm: "Warm und freundlich",
    userProfileStyleCalmDescription:
      "Verwendet knappe, direkte Sprache mit Fokus auf Effizienz und präzise Bedeutung, in einem ernsten, sachlichen und kooperativen Ton.",
    userProfileStyleNeutralDescription:
      "Ein ausgewogener, natürlicher Ton, weder förmlich noch überschwänglich: direkt und ehrlich, ohne Schmeichelei und Übertreibung.",
    userProfileStyleWarmDescription:
      "Spricht wie ein hilfsbereiter guter Freund: herzlich und begeistert und bei Bedarf auch emotional unterstützend.",
    userProfileStyleMonetNotice:
      "Der Monet-Modus ist aktiv und ersetzt diese Einstellung.",
    userProfileTechLabel: "Technischer Hintergrund",
    userProfileTechGeneral: "Allgemeiner Benutzer",
    userProfileTechProfessional: "Professioneller Benutzer",
    userProfileTechGeneralDescription:
      "Vermeidet unnötigen Fachjargon, erklärt die Arbeit in klarer, zielorientierter Sprache, hilft bei der Wahl der klügsten Option und bietet einfache Alternativen an, wenn etwas schiefgeht.",
    userProfileTechProfessionalDescription:
      "Verzichtet auf übermäßige Erklärungen, vermittelt komplexe technische Details direkt und bietet einem experimentierfreudigen Benutzer anspruchsvolle Lösungen, wobei der konstruktivste Weg gewählt wird.",
    interactiveAnswers: "Interaktive Antworten",
    interactiveAnswersDescription:
      "Pine darf bei Bedarf interaktive Checklisten, Rechner, Tabellen und Diagramme in Antworten einfügen.",
    interactiveAnswersEnabled: "Aktiviert",
    interactiveAnswersDisabled: "Deaktiviert",
    userProfileDetailsLabel: "Weitere persönliche Angaben",
    userProfileDetailsPlaceholder:
      "Zum Beispiel: Ihr Beruf, Interessen, Vorlieben oder aktuelle Ziele",
    userProfileDetailsDescription:
      "Diese Angaben helfen Pine, Sie besser zu verstehen.",
    userProfileInstructionsLabel: "Benutzerdefinierte Anweisungen",
    userProfileInstructionsPlaceholder:
      "Geben Sie weitere Wünsche an, wie Pine arbeiten soll…",
    userProfileInstructionsDescription:
      "Personalisierung auf Systemebene; Sicherheits- und Freigaberegeln gelten weiterhin.",
  },
  models: {
    favorites: "Favoriten",
    loading: "Modelle werden geladen",
    recent: "Zuletzt verwendet",
    recommended: "Empfohlene Modelle",
    reasoning: "Denkaufwand",
    picker: {
      title: "Modell auswählen",
      description:
        "Durchsuchen Sie eingerichtete Modelle oder fügen Sie einen Anbieter hinzu",
      searchPlaceholder: "Anbieter und Modelle suchen…",
      empty: "Keine passenden Modelle",
      manageServiceOrModel: "Anbieter und Modelle verwalten",
      addCustomModel: "Eigenes Modell hinzufügen",
      addFavorite: "{model} als Favorit markieren",
      backToModels: "Zurück zu den Modellen",
      browse: "Alle Modelle durchsuchen…",
      contextWindow: "Kontextfenster: {tokens}",
      decisionsTitle: "Decisions-Modell auswählen",
      decisionsDescription:
        "Wählen Sie mit Ihren OpenRouter-Zugangsdaten ein Vorsortiermodell aus dem Decisions-Katalog.",
      decisionsSearchPlaceholder: "Decisions-Modelle suchen",
      decisionsEmpty: "Keine passenden Decisions-Modelle",
      imageTitle: "Bildmodell auswählen",
      imageDescription:
        "Durchsuchen Sie die Bildmodelle von OpenRouter und wählen Sie das Standardmodell für die Bilderzeugung.",
      imageSearchPlaceholder: "Bildmodelle suchen…",
      imageEmpty: "Keine passenden Bildmodelle",
      videoTitle: "Videomodell auswählen",
      videoDescription:
        "Durchsuchen Sie die Videomodelle von OpenRouter und wählen Sie das Standardmodell für die Videoerzeugung.",
      videoSearchPlaceholder: "Videomodelle suchen…",
      videoEmpty: "Keine passenden Videomodelle",
      recommended: "Empfohlen",
      removeFavorite: "{model} aus den Favoriten entfernen",
      vision: "Bilderkennung",
      editCustomModel: "Eigenes Modell bearbeiten",
      deleteCustomModel: "Eigenes Modell löschen",
      deleteCustomModelTitle: "{model} löschen?",
      deleteCustomModelDescription:
        "Das eigene Modell wird aus der lokalen Datei models.json entfernt.",
    },
    custom: {
      title: "Modell hinzufügen",
      description:
        "Erstellen Sie einen Anbieter oder fügen Sie einem bereits genutzten Anbieter ein Modell hinzu.",
      providerMode: "Anbieter",
      newProvider: "Eigener Anbieter",
      existingProvider: "Vorhandener Anbieter",
      provider: "Vorhandener Anbieter",
      selectProvider: "Anbieter auswählen",
      existingProviderDescription:
        "Verwendet den vorhandenen Endpunkt und die Zugangsdaten dieses Anbieters.",
      providerName: "Anbietername",
      providerNamePlaceholder: "Mein lokaler Anbieter",
      providerId: "Anbieter-ID",
      providerIdInvalid:
        "Geben Sie eine gültige Anbieter-ID aus Kleinbuchstaben, Ziffern, Punkten, Bindestrichen oder Unterstrichen ein.",
      baseUrl: "Basis-URL",
      api: "API-Format",
      apiKey: "API-Schlüssel oder Wertreferenz",
      apiKeyPlaceholder: "API-Schlüssel, $ENV_VAR oder ein lokaler Platzhalter",
      apiKeyDescription:
        "Wird lokal in models.json gespeichert. Statt ein Geheimnis zu speichern, können Sie $ENV_VAR verwenden; lokale Server ohne Schlüssel akzeptieren jeden Platzhalter.",
      modelName: "Modellname (optional)",
      modelNamePlaceholder: "In Pine angezeigt",
      modelId: "Modell-ID",
      contextWindow: "Kontextfenster",
      maxTokens: "Maximale Ausgabe-Token",
      thinkingLevels: "Unterstützte Denkstufen",
      thinkingLevelsDescription:
        "Wählen Sie alle Stufen, die dieses Modell akzeptiert. Lassen Sie bei einem Modell ohne Denkfunktion nur „Aus“ ausgewählt.",
      vision: "Bildeingabe",
      visionDescription: "Das Modell akzeptiert Text und Bilder.",
      tryAutoFill: "Automatisch ausfüllen",
      autoFillDescription:
        "Sucht die eingegebene Modell-ID in models.dev und füllt Anzeigename, Kontext- und Ausgabelimits, Bildunterstützung und die bekannte Denkfähigkeit aus. Prüfen Sie die Werte vor dem Speichern.",
      save: "Modell hinzufügen",
      editTitle: "Eigenes Modell bearbeiten",
      editDescription:
        "Aktualisieren Sie die Einstellungen dieses Modells, ohne den Anbieter zu ändern.",
      editProviderDescription:
        "Der Anbieter kann nach dem Erstellen des Modells nicht mehr geändert werden.",
      editSave: "Modell speichern",
    },
    thinkingLevels: {
      off: "Aus",
      minimal: "Minimal",
      low: "Niedrig",
      medium: "Mittel",
      high: "Hoch",
      xhigh: "Sehr hoch",
      max: "Maximum",
    },
    thinkingLevelWarnings: {
      max: "Die Denkstufe „Maximum“ kann länger dauern und mehr kosten, ohne oft eine spürbare Verbesserung zu bringen.",
      off: "Moderne Modelle erreichen in Pine ihre beste Leistung mit aktiviertem Denken. Wir raten bei keinem Modell davon ab, das Denken zu deaktivieren.",
    },
  },
  providers: {
    connected: "Verbunden",
    custom: {
      label: "Benutzerdefiniert",
      edit: "Eigenen Anbieter bearbeiten",
      delete: "Eigenen Anbieter löschen",
      editTitle: "Eigenen Anbieter bearbeiten",
      editDescription:
        "Aktualisieren Sie den Endpunkt und die Zugangsdaten dieses Anbieters.",
      idDescription:
        "Die Anbieter-ID wird von gespeicherten Modellauswahlen verwendet und kann nicht geändert werden.",
      apiKeyPlaceholder: "Leer lassen, um den aktuellen Wert beizubehalten",
      apiKeyDescription:
        "Leer lassen, um den aktuellen Schlüssel oder die Wertreferenz beizubehalten.",
      save: "Anbieter speichern",
      deleteTitle: "{provider} löschen?",
      deleteDescription:
        "Der Anbieter und alle seine eigenen Modelle werden aus der lokalen Datei models.json entfernt.",
      invalidDescription:
        "Geben Sie einen Anbieternamen und eine gültige HTTP- oder HTTPS-URL ein.",
    },
    disconnect: "{provider} trennen",
    disconnectConfirm: "Zugangsdaten löschen und trennen",
    disconnectDescription:
      "Dadurch werden die von Pine gespeicherten Zugangsdaten für {provider} gelöscht und seine Modelle vorübergehend nicht verfügbar. Sie können sich jederzeit wieder verbinden.",
    disconnectTitle: "{provider} trennen?",
    modelCount: "{count} Modelle",
    picker: {
      title: "Anbieter auswählen",
      description: "Den integrierten Anbieterkatalog von Pi durchsuchen",
      searchPlaceholder: "Anbieter suchen…",
      empty: "Keine passenden Anbieter",
      all: "Anbieter",
    },
    auth: {
      title: "{provider} verbinden",
      method: "Authentifizierungsmethode",
      openBrowser: "Browser öffnen",
      deviceCode: "Geben Sie diesen Code im Browser ein:",
      chooseOption: "Option auswählen",
      manualCodeDescription:
        "Fügen Sie den Autorisierungscode aus Ihrem Browser ein.",
      connected: "Anbieter verbunden.",
      waiting: "Warten auf den Anbieter…",
      continue: "Weiter",
    },
  },
  projects: {
    title: "Projekte",
    temporaryWorkspace: "Kein Projekt",
    temporaryWorkspaceDescription:
      "Schnelle Arbeit, die zu keinem Projekt gehört",
    openElsewhere: "In einem anderen Fenster öffnen",
    deleteAction: "Projekt löschen",
    welcomeTitle: "Legen wir los",
    description:
      "Ordnen Sie Sitzungen und legen Sie genau fest, auf welche Ordner die KI zugreifen darf.",
    createAction: "Neues Projekt",
    createDescription: "Wählen Sie Ordner, auf die die KI zugreifen darf",
    createTitle: "Neues Projekt",
    editTitle: "Projekt bearbeiten",
    openAction: "Öffnen",
    emptyTitle: "Noch keine Projekte",
    emptyDescription:
      "Erstellen Sie ein Projekt und wählen Sie die Ordner aus, auf die die KI für ihre Aufgaben zugreifen darf.",
    folderCount: "{count} Ordner",
    unavailable: "Nicht verfügbar",
    lastOpened: "Zuletzt geöffnet: {date}",
    projectActions: "Aktionen für {name}",
    deleteTitle: "Projekt löschen?",
    deleteDescription:
      "Dadurch werden die Pine-Metadaten und Sitzungen von „{name}“ gelöscht. Von Ihnen hinzugefügte Dateien werden nie gelöscht.",
    searchLabel: "Projekte durchsuchen",
    searchPlaceholder: "Projekte suchen…",
    access: {
      metadata: "Dateimetadaten",
      file: "Datei",
      text: "Text",
      lines: "{count} Zeilen",
      sendToTab: "An Tab senden…",
      noSessionTabs: "Keine Sitzungs-Tabs geöffnet",
      sendFailed: "Die Datei konnte der Sitzung nicht angehängt werden",
      readOnly: "Nur Lesen",
      readWrite: "Lesen und Schreiben",
    },
    editor: {
      dialogDescription:
        "Legen Sie den Projektnamen und die Ordner fest, auf die seine Sitzungen zugreifen dürfen.",
      nameLabel: "Projektname",
      namePlaceholder: "Mein neues Projekt",
      iconLabel: "Projektsymbol",
      colorThemeLabel: "Akzentfarbe des Projekts",
      colorThemes: {
        default: "Pine-Standard",
        neutral: "Neutral",
        olive: "Oliv",
        red: "Rot",
        rose: "Rosa",
        orange: "Orange",
        green: "Grün",
        blue: "Blau",
        yellow: "Gelb",
        violet: "Violett",
      },
      defaultFolderLabel: "Standardordner",
      chooseDefaultFolder: "Standardordner auswählen",
      changeDefaultFolder: "Ändern",
      contextFoldersLabel: "Zusätzliche Kontextordner (optional)",
      addContextFolders: "Ordner hinzufügen",
      removeFolder: "Ordner entfernen",
      folderName: "Anzeigename",
      folderPath: "Pfad",
      accessLabel: "Zugriff",
      actionsLabel: "Aktionen",
      folderAccess: "Zugriff für {name}",
      hostFolder: {
        title: "Ordner auf dem Pine-Computer",
        description:
          "Der Browser kann den Computer, auf dem Pine läuft, nicht durchsuchen. Geben Sie den vollständigen Pfad des Ordners ein.",
        placeholder: "/Users/sie/Projects/app",
        hint: "Verwenden Sie einen absoluten Pfad, etwa /Users/sie/Projects/app.",
        absoluteRequired: "Geben Sie einen absoluten Pfad ein.",
        confirm: "Hinzufügen",
      },
    },
  },
  skills: {
    title: "Skills",
    description:
      "Verwalten Sie globale und projektbezogene Anweisungen. Globale Schalter gelten nur für dieses Projekt.",
    scope: { global: "Global", project: "Projekt" },
    piPackageReadOnly:
      "Wird von einem installierten Pi-Paket bereitgestellt. Bearbeiten Sie die Paketquelle, um diesen Skill zu ändern.",
    globalEnabledLabel: "{name} in diesem Projekt verwenden",
    new: "Neuer Skill",
    create: "Erstellen",
    empty: "Keine Skills in diesem Bereich",
    untitled: "Unbenannter Skill",
    draftBadge: "Entwurf",
    emptyDescription:
      "Ein Skill ist eine wiederverwendbare Anweisung. Der Agent nutzt ihn selbstständig, wenn eine Aufgabe zur Beschreibung passt.",
    nameLabel: "Name",
    namePlaceholder: "release-notes",
    nameHint:
      "Lässt sich später nicht ändern. Eingaben werden in Kleinbuchstaben, Ziffern und Bindestriche umgewandelt.",
    nameErrors: {
      required: "Geben Sie einen Namen ein",
      invalid:
        "Nur Kleinbuchstaben, Ziffern und Bindestriche, ohne Bindestrich am Ende",
      tooLong: "Der Name darf höchstens {max} Zeichen lang sein",
    },
    descriptionLabel: "Wann verwenden",
    descriptionPlaceholder:
      "Zum Beispiel: Beim Schreiben von Release Notes verwenden. Fasst sichtbare Änderungen im CHANGELOG-Format des Projekts zusammen.",
    descriptionHint: "Der Agent entscheidet hieran, wann er den Skill nutzt.",
    descriptionErrors: {
      required: "Beschreiben Sie, was dieser Skill tut und wann er passt",
      tooLong: "Die Beschreibung darf höchstens {max} Zeichen lang sein",
    },
    instructionsLabel: "Anweisungen",
    instructionsHint:
      "Markdown wird unterstützt. Der Agent liest den gesamten Inhalt, wenn er den Skill nutzt.",
    contentPlaceholder:
      "Schreiben Sie die Schritte, Regeln und Beispiele, denen der Agent bei dieser Aufgabe folgen soll",
    templatesLabel: "Vorlage:",
    templates: {
      workflow: {
        label: "Ablauf",
        content:
          "## Ziel\n\n- \n\n## Schritte\n\n1. \n2. \n3. \n\n## Fertig, wenn\n\n- \n",
      },
      checklist: {
        label: "Regelliste",
        content:
          "## Gilt für\n\n- \n\n## Immer\n\n- \n\n## Vermeiden\n\n- \n\n## Beispiele\n\n\n",
      },
      reference: {
        label: "Referenz",
        content:
          "## Hintergrund\n\n\n\n## Wichtige Begriffe\n\n- \n\n## Häufige Fragen\n\n- \n",
      },
    },
    optional: "Optional",
    licenseLabel: "Lizenz",
    licenseNone: "Keine",
    licenseCustom: "Andere…",
    licenseCustomPlaceholder: "Lizenzname oder -datei, z. B. LICENSE.txt",
    compatibilityLabel: "Umgebungsanforderungen",
    compatibilityPlaceholder: "Zum Beispiel: Benötigt git und Node.js 20+",
    compatibilityHint:
      "Kommandozeilenwerkzeuge, Systeme oder Netzwerkzugriff, von denen dieser Skill abhängt.",
    compatibilityTooLong: "Höchstens {max} Zeichen",
    allowedToolsLabel: "Vorab erlaubte Werkzeuge",
    allowedToolsHint:
      "Teilt dem Agenten mit, dass er diese Werkzeuge sofort nutzen darf, wenn der Skill verwendet wird. Pines Berechtigungen und Freigaben gelten weiterhin.",
    allowedToolsCustomPlaceholder: "Weiteres Werkzeug, mit Enter hinzufügen",
    allowedToolsAdd: "Hinzufügen",
    removeTool: "{name} entfernen",
    toolGroups: {
      inspect: "Ansehen",
      modify: "Ändern",
      run: "Ausführen",
      web: "Web",
    },
    tools: {
      read: "Datei lesen",
      find: "Dateien nach Namen finden",
      grep: "Inhalte durchsuchen",
      edit: "Vorhandene Dateien bearbeiten",
      write: "Dateien anlegen oder überschreiben",
      shell: "Shell-Befehle ausführen",
      webSearch: "Im Web suchen",
      webFetch: "URL öffnen",
    },
    unsaved: "Ungespeicherte Änderungen",
    resourcesLabel: "Mitgelieferte Ressourcen:",
    deleteTitle: "Skill löschen?",
    deleteDescription:
      "Möchten Sie „{name}“ wirklich löschen? Dies kann nicht rückgängig gemacht werden.",
  },
  sessions: {
    moreSidebarMenu: "Mehr",
    searchTitle: "Sitzungen durchsuchen",
    searchDescription:
      "Titel und Unterhaltungsinhalte in allen Projekten durchsuchen",
    searchPlaceholder: "Sitzungsinhalte durchsuchen",
    searchAction: "Sitzungen durchsuchen",
    attachTitle: "Unterhaltung hinzufügen",
    attachDescription:
      "Suchen Sie eine Unterhaltung, die als JSONL-Datei angehängt werden soll",
    searching: "Suche läuft",
    newSession: "Neue Sitzung",
    showMore: "Mehr anzeigen",
    newProjectSession: "Neue Sitzung in {project}",
    current: "Aktuell",
    noSessions: "Noch keine Sitzungen",
    fromWeChat: "Aus WeChat",
    usedFromWeChat: "Aus WeChat verwendet",
    awaitingApproval: "Wartet auf deine Freigabe",
    showSubSessions: "Untersitzungen anzeigen ({count})",
    hideSubSessions: "Untersitzungen ausblenden ({count})",
    deleteSubSessions: "Mitgelöschte Untersitzungen: {count}.",
    noResults: "Keine passenden Sitzungen",
    groupTitle: "Sitzungsordner",
    createGroupAction: "Neuer Ordner",
    newProjectGroup: "Neuer Ordner in {project}",
    createGroupTitle: "Ordner erstellen",
    createGroupDescription:
      "Fassen Sie zusammengehörige Unterhaltungen des Projekts zusammen.",
    renameGroupAction: "Ordner umbenennen",
    renameGroupTitle: "Ordner umbenennen",
    renameGroupDescription:
      "Geben Sie einen neuen Namen für diesen Ordner ein.",
    deleteGroupAction: "Ordner löschen",
    deleteGroupTitle: "Ordner löschen?",
    deleteGroupDescription:
      "Der Ordner „{name}“ wird gelöscht. Seine Unterhaltungen kehren ins Projekt zurück und bleiben erhalten.",
    groupNameLabel: "Ordnername",
    groupNamePlaceholder: "z. B. Produktplanung",
    emptyGroup: "Keine Unterhaltungen in diesem Ordner",
    moveToGroupAction: "In Ordner verschieben",
    removeFromGroupAction: "Aus Ordner entfernen",
    renameAction: "Unterhaltung umbenennen",
    exportAction: "Unterhaltung exportieren",
    exportSuccess: "Unterhaltung exportiert",
    exportFailedTitle: "Die Unterhaltung konnte nicht exportiert werden",
    exportFailedDescription:
      "Wählen Sie einen beschreibbaren Speicherort für die Markdown-Datei und versuchen Sie es erneut.",
    renameTitle: "Unterhaltung umbenennen",
    renameDescription:
      "Geben Sie einen neuen Namen für diese Unterhaltung ein.",
    nameLabel: "Name der Unterhaltung",
    deleteAction: "Unterhaltung löschen",
    deleteTitle: "Unterhaltung löschen?",
    deleteDescription:
      "„{name}“ und die zugehörigen Nachrichten werden dauerhaft gelöscht.",
  },
  mcp: {
    title: "MCP-Server",
    description:
      "Verbinden Sie externe Werkzeuge über den MCP-Adapter. Änderungen gelten für die aktuelle Sitzung.",
    project: "Projekt",
    global: "Alle Projekte",
    name: "Servername",
    definition: "Serverkonfiguration (JSON)",
    definitionHelp:
      "Verwenden Sie command und args für einen lokalen Server oder url für einen entfernten Server. Weitere Adapteroptionen können hier ergänzt werden.",
    configured: "Eingerichtet",
    status: {
      connected: "Verbunden",
      disabled: "Deaktiviert",
      needsAuth: "Autorisierung erforderlich",
      failed: "Verbindung fehlgeschlagen",
      cached: "Zwischengespeichert",
      notConnected: "Nicht verbunden",
    },
    enabled: "Server aktivieren",
    empty: "Keine Server eingerichtet",
    emptyDescription:
      "Fügen Sie einen Server hinzu, damit der Agent seine Werkzeuge nutzen kann.",
    add: "Server hinzufügen",
    edit: "Bearbeiten",
    editTitle: "MCP-Server bearbeiten",
    remove: "Entfernen",
    cancel: "Abbrechen",
    save: "Speichern",
    refresh: "Status aktualisieren",
    saved: "MCP-Server gespeichert",
    removed: "MCP-Server entfernt",
    invalidName:
      "Verwenden Sie für den Servernamen Buchstaben, Ziffern, Punkte, Unterstriche oder Bindestriche.",
    invalidDefinition:
      "Geben Sie ein JSON-Objekt mit einem Befehl oder einer URL ein.",
    duplicateName:
      "In diesem Bereich gibt es bereits einen Server mit diesem Namen.",
    removeTitle: "MCP-Server entfernen?",
    removeDescription: "{name} aus dieser Konfiguration entfernen?",
  },
  project: {
    sideChat: {
      title: "Seitenchat",
      followUpTitle: "Nachfrage",
      notSaved: "Nicht gespeichert",
      delete: "Nachfrage löschen",
      close: "Seitenchat schließen",
      readOnlyHint:
        "Frag zu diesem Gespräch. Ein Seitenchat kann Dateien lesen und im Web suchen, aber nichts ändern.",
      placeholder: "Frage stellen",
      stop: "Stoppen",
      send: "Senden",
      sendFailed: "Frage konnte nicht gesendet werden",
      deleteFailed: "Nachfrage konnte nicht gelöscht werden",
      deleteTitle: "Diese Nachfrage löschen?",
      deleteDescription:
        "Die Nachfrage und ihre Antworten werden dauerhaft gelöscht, und die Textstelle wird nicht mehr hervorgehoben.",
      deleteConfirm: "Löschen",
      openFailed: "Seitenchat konnte nicht geöffnet werden",
      needsConversation: "Sende zuerst eine Nachricht",
      waitForMessage: "Warte, bis die Antwort fertig ist",
      overlaps: "Dieser Text gehört schon zu einer Nachfrage",
      discardTitle: "Seitenchat schließen?",
      discardDescription:
        "Dieser Seitenchat wird nicht gespeichert. Beim Schließen gehen Fragen und Antworten verloren.",
      discard: "Schließen und verwerfen",
      discardTabTitle: "Diesen Tab schließen?",
      discardTabDescription:
        "Diese Unterhaltung hat einen nicht gespeicherten Seitenchat. Beim Schließen des Tabs werden seine Fragen und Antworten dauerhaft gelöscht.",
      discardTab: "Tab schließen",
    },
    quote: {
      label: "Zitat",
      listLabel: "Zitierte Stellen",
      remove: "Zitat entfernen",
    },
    selection: {
      label: "Ausgewählter Text",
      quote: "Zitieren",
      followUp: "Nachfragen",
    },
    closeProject: "Projekt schließen",
    workbench: {
      toggle: "Arbeitsbereich ein-/ausblenden",
      switchPanel: "Bereich wechseln",
      resize: "Größe des Arbeitsbereichs ändern",
      resizeCards: "Größe der Karten ändern",
      addCard: "Karte hinzufügen",
      closeCard: "Karte schließen",
      panels: {
        artifacts: "Artefakte",
        tasks: "Hintergrundprozesse",
        preview: "Vorschau",
        files: "Dateien",
        "side-chat": "Seitenchat",
      },
      artifacts: {
        empty:
          "Dateien, die Pine Ihnen in dieser Unterhaltung zeigt, erscheinen hier.",
        openFailed: "Diese Datei konnte nicht geöffnet werden",
        preview: "Im Arbeitsbereich ansehen",
      },
      preview: {
        empty:
          "Wählen Sie unter Artefakte eine Datei aus, um sie hier anzuzeigen.",
        failed: "Diese Datei konnte nicht geladen werden",
        unsupported: "Für diese Datei ist keine Vorschau möglich",
        openInTab: "In Tab öffnen",
      },
    },
    todos: {
      heading: "Aufgaben",
      progress: "{completed}/{total}",
      blockedBy: "nach {ids}",
      statuses: {
        pending: "Offen",
        in_progress: "In Arbeit",
        completed: "Erledigt",
        deleted: "Gelöscht",
      },
      dialog: {
        title: "Alle Aufgaben",
        summaryCompleted: "{completed}/{total} erledigt",
        summaryInProgress: "{count} in Arbeit",
        summaryPending: "{count} offen",
        emptyTitle: "Noch keine Aufgaben",
        emptyDescription: "Bitten Sie den Agenten, welche anzulegen!",
      },
    },
    backgroundTasks: {
      heading: "Hintergrundprozesse",
      running: "{count} laufen",
      empty: "Keine Hintergrundprozesse",
      stop: "Beenden",
      native: "Native Berechtigungen",
      sandboxed: "Projekt-Sandbox",
      exitCode: "Exit {code}",
      stopped: "{name} beendet",
      stopFailed: "Der Prozess konnte nicht beendet werden",
      statuses: {
        running: "Läuft",
        completed: "Abgeschlossen",
        failed: "Fehlgeschlagen",
        killed: "Beendet",
      },
      dialog: {
        description: "{status} · {id}",
        duration: "Dauer",
        started: "Gestartet",
        ended: "Beendet",
        permissions: "Berechtigungen",
        timeout: "Zeitlimit",
        timeoutValue: "{seconds} s",
        exitCode: "Exit-Code",
        command: "Befehl",
        details: "Beschreibung",
        outputFile: "Ausgabedatei",
        error: "Fehler",
        output: "Ausgabe",
        noOutput: "Noch keine Ausgabe",
        outputTail: "Die letzten {shown} von {total} werden angezeigt",
        outputFailed: "Die Ausgabe konnte nicht gelesen werden",
        copyPath: "Pfad kopieren",
        pathCopied: "Ausgabepfad kopiert",
        copyFailed: "Der Pfad konnte nicht kopiert werden",
        gone: "Dieser Prozess ist nicht mehr verfügbar.",
      },
    },
    preferences: "Projekteinstellungen",
    manageProjects: "Projekte verwalten",
    version: "Version {version}",
    skills: "Skills",
    preview: {
      metadata: "Dateimetadaten",
      file: "Datei",
      text: "Text",
      lines: "{count} Zeilen",
      pages: "{count} Seiten",
      sendToTab: "An Tab senden…",
      sendSelectionToTab: "Auswahl an Tab senden…",
      rendered: "Gerendert",
      invertColors: "Farben invertieren",
      zoom: "Zoom",
      zoomValue: "Zoom: {value} %",
      openDefault: "Mit Standardanwendung öffnen",
      openDefaultFailed:
        "Die Datei konnte nicht mit der Standardanwendung geöffnet werden",
      selectedContent: "Ausgewählter Inhalt",
      newSession: "Sitzung erstellen",
      noSessionTabs: "Keine Sitzungs-Tabs geöffnet",
      sendFailed: "Die Datei konnte der Sitzung nicht angehängt werden",
      failedTitle: "Vorschau der Datei nicht möglich",
      failedDescription:
        "Die Datei wurde möglicherweise verschoben oder gelöscht oder verwendet eine nicht unterstützte Kodierung oder ein nicht unterstütztes Medienformat.",
      retry: "Erneut versuchen",
      unsupportedTitle: "Vorschau nicht verfügbar",
      unsupportedDescription:
        "Unterstützt werden Text und Code, Bilder, Audio und Video, PDF, Office-Dokumente, Archive, E-Mails, E-Books, CAD-Zeichnungen, 3D-Modelle und mehr.",
      tooLarge:
        "Textdateien über 2 MB können noch nicht in der Vorschau angezeigt werden.",
      documentTooLarge:
        "Dateien über 1 GB können noch nicht in der Vorschau angezeigt werden.",
      documentControls: "Dokumentsteuerung",
      search: "Im Dokument suchen",
      searchPrevious: "Vorheriger Treffer",
      searchNext: "Nächster Treffer",
      searchCount: "{current}/{total}",
      previousPage: "Vorherige Seite",
      nextPage: "Nächste Seite",
      page: "Seite",
      fitWidth: "An Breite anpassen",
      play: "Wiedergabe",
      pause: "Pause",
      seek: "Wiedergabeposition",
      mute: "Stummschalten",
      unmute: "Ton einschalten",
      rotateLeft: "Nach links drehen",
      rotateRight: "Nach rechts drehen",
      tableSize: "{rows} Zeilen · {columns} Spalten",
      rowNumber: "Zeilennummer",
      truncatedRows: "Die ersten {count} Zeilen werden angezeigt",
      table: "Tabelle",
      fontSamplePlaceholder: "Beispieltext eingeben",
      fontSampleCjk: "天地玄黄 宇宙洪荒 The quick brown fox",
      fontVersion: "Version {version}",
      fontGlyphs: "{count} Glyphen",
      copyColor: "{color} kopieren",
      colorCopied: "{color} kopiert",
      colorCopyFailed: "Die Farbe konnte nicht kopiert werden",
      paletteEmpty: "Die Palette enthält keine Farben",
      layers: "Ebenen",
      showAllLayers: "Alle Ebenen anzeigen",
      hideAllLayers: "Alle Ebenen ausblenden",
      pianoRoll: "Piano Roll",
      midiTempo: "{bpm} BPM",
      midiTracks: "{count} Spuren",
      midiNotes: "{count} Noten",
      midiTrack: "Spur",
      midiInstrument: "Instrument",
      midiChannel: "Kanal",
      midiNoteCount: "Noten",
      psdUntitledLayer: "Unbenannte Ebene",
      midiUntitled: "Spur {index}",
      midiPercussion: "Schlagzeug",
      toggleTrack: "{name} ein- oder ausblenden",
      archiveFilter: "Dateien filtern",
      archiveChoose: "Wählen Sie eine Datei für die Vorschau",
      archiveLocked: "Dieses Archiv ist verschlüsselt",
      archiveWrongPassword: "Das Passwort ist falsch",
      archivePassword: "Passwort",
      archiveUnlock: "Öffnen",
      sheet: "Tabellenblatt",
      sheetFallback: "Tabellenblatt {index}",
      geoNoProperties: "Dieses Objekt hat keine Eigenschaften",
      modelFit: "An Ansicht anpassen",
      modelDisplay: "Anzeigeoptionen",
      modelWireframe: "Drahtgitter",
      modelGrid: "Raster",
      modelAxes: "Achsen",
      modelRotate: "Automatisch drehen",
      modelStats: "{meshes} Meshes · {triangles} Dreiecke",
      modelUnsupported:
        "IFC und Rhino 3DM benötigen eine Modellierungs-Engine, die Pine noch nicht enthält.",
      modelPoints: "{points} Punkte",
      zoomIn: "Vergrößern",
      zoomOut: "Verkleinern",
      cadMonochrome: "Einfarbig",
      cadExport: "Als Bild exportieren",
      cadStats: "{entities} Objekte · {layers} Ebenen",
      edaView: "Inhaltsansicht",
      edaStreams: "Streams {count}",
      edaStrings: "Text {count}",
      edaStream: "Stream",
      edaSize: "Bytes",
      edaText: "Text",
      edaLayer: "Ebene {layer}",
      ebookContents: "Inhaltsverzeichnis",
      ebookChapterFailed: "Dieses Kapitel konnte nicht geöffnet werden.",
      worksheet: "Arbeitsblatt",
      slideshow: "Präsentieren",
      pageLabel: "Seite {page}",
      typstFailed: "Dieses Typst-Dokument lässt sich nicht kompilieren",
      mailView: "Nachrichtenansicht",
      mailBody: "Nachricht",
      mailHeaders: "Header",
      mailFrom: "Von",
      mailTo: "An",
      mailCc: "Cc",
      mailDate: "Datum",
      mailEmpty: "Diese Nachricht hat keinen Inhalt",
      mailNoSubject: "(Kein Betreff)",
      mailUnknownSender: "Unbekannter Absender",
      archiveEmpty: "Keine Dateien gefunden",
      archiveEmptyDescription:
        "Das Archiv ist leer oder verwendet eine Kompression, die Pine nicht lesen kann, etwa Zstandard.",
    },
    contentTabs: {
      emptyTitle: "Keine Tabs geöffnet",
      emptyDescription:
        "Wählen Sie in der Seitenleiste eine Datei für die Vorschau aus oder starten Sie eine neue Sitzung.",
      newSession: "Neue Sitzung",
      addTab: "Sitzungs-Tab hinzufügen",
      moreActions: "Weitere Aktionen",
      closeTab: "{name} schließen",
      switchTab: "Tab wechseln",
      switchComputer: "Computer wechseln",
      tabListLabel: "Geöffnete Inhalte",
      shortcuts: {
        newTab: "Neuer Tab",
        closeTab: "Tab schließen",
        newWindow: "Neues Fenster",
        toggleSidebar: "Linke Seitenleiste ein-/ausblenden",
        toggleWorkbench: "Arbeitsbereich ein-/ausblenden",
      },
    },
    composer: {
      sendTo: "An {name} senden",
      sendToLabel: "Projekt für diese Sitzung auswählen",
      chooseProjectLabel: "Projekte",
      chooseProjectPlaceholder: "Projektnamen eingeben…",
      chooseProjectHint: "auswählen",
      skipProjectHint: "schließen",
      noProjectMatches: "Keine passenden Projekte",
      label: "Sitzungsnachricht",
      placeholder:
        "Beschreiben Sie eine Aufgabe oder präzisieren Sie, was Sie brauchen…",
      draftPlaceholder:
        "Beschreiben Sie eine Aufgabe oder geben Sie {'@'} ein, um ein Projekt auszuwählen",
      steeringPlaceholder: "Anforderungen ergänzen oder die Richtung ändern…",
      addAttachment: "Anhang hinzufügen",
      addFile: "Datei hinzufügen",
      addFolder: "Ordner hinzufügen",
      addSession: "Unterhaltung",
      folderAttachment: "Ordner",
      attachmentLines: "Zeilen {startLine}–{endLine}",
      openAttachment: "Anhang {name} öffnen",
      attachmentOpenFailed:
        "Der Anhang konnte nicht mit der Standardanwendung des Systems geöffnet werden",
      removeAttachment: "Anhang {name} entfernen",
      contextSelection: "Ausgewählt: „{text}“",
      authoring: {
        skill: "Skill mit Pine erstellen",
        automation: "Automatisierung mit Pine erstellen",
        mcp: "MCP-Server mit Pine verwalten",
        remove: "Stattdessen normal unterhalten",
      },
      contextRemove: "zum Entfernen",
      attachmentPickerFailed:
        "Die ausgewählten Elemente konnten nicht geöffnet oder geprüft werden",
      attachmentDropFailed:
        "Die abgelegten Anhänge konnten nicht geprüft werden",
      attachmentPasteFailed:
        "Der eingefügte Text, das Bild oder die Datei konnte nicht gespeichert werden",
      sessionAttachmentFailed:
        "Die ausgewählte Unterhaltung konnte nicht angehängt werden",
      dropAttachmentsTitle: "Zum Hinzufügen von Anhängen ablegen",
      dropAttachmentsDescription:
        "Sie können mehrere Dateien oder Ordner gleichzeitig hinzufügen",
      send: "Nachricht senden",
      steer: "Antwort lenken",
      stop: "Antwort stoppen",
      withdrawSteering: "Vorgemerkte Nachricht zurückziehen",
      withdrawSteeringFailed:
        "Die vorgemerkte Nachricht konnte nicht zurückgezogen werden",
      withdrawSteeringLabel: "Zurückziehen",
      sendSteeringNow: "Vorgemerkte Nachricht jetzt senden",
      sendSteeringNowLabel: "Jetzt senden",
      sendSteeringNowFailed:
        "Die vorgemerkte Nachricht konnte nicht gesendet werden",
      model: "Modell",
      selectModel: "Modell auswählen",
      reasoningEffort: "Denkaufwand",
      approval: {
        askForPermissionLabel: "Selbst prüfen",
        askForPermission:
          "Fragt bei nicht autorisierten Vorgängen außerhalb des Arbeitsbereichs nach Bestätigung.",
        agentDecidesLabel: "Automatisch genehmigen",
        agentDecides: "Balanciert Autonomie und Kontrolle; fragt gezielt nach.",
        autonomousLabel: "Autonomes Arbeiten",
        autonomous: "Maximale Autonomie; hält nie zum Nachfragen an.",
        yoloLabel: "YOLO",
        yolo: "Hebt alle Berechtigungsbeschränkungen auf. Nicht empfohlen.",
        yoloConfirmTitle: "„YOLO“ aktivieren?",
        yoloConfirmDescription:
          "Auch wenn moderne Sprachmodelle deutlich besser geworden sind, können ihre Ergebnisse weiterhin unvorhersehbar sein. Wenn Sie diese Option aktivieren, übernehmen Sie die Verantwortung für unwiderruflichen Datenverlust und andere mögliche Risiken.",
        yoloConfirmAction: "Aktivieren",
      },
      contextUsage: {
        label: "Kontextauslastung",
        usedTokens: "Verbrauchte Token",
        contextWindow: "Kontextfenster",
        utilization: "Auslastung",
        cost: "Kosten der Unterhaltung",
        cacheHitRate: "Cache-Trefferquote",
        unknown: "Unbekannt",
        compactNow: "Kontext jetzt verdichten",
        compacting: "Wird verdichtet…",
        costLimit: "Kostenlimit der Sitzung",
        limitReachedTitle: "Kostenlimit erreicht",
        limitReachedDescription:
          "Diese Sitzung hat {cost} ausgegeben, das Limit von {limit} erreicht und wurde gestoppt.",
        limitReachedPrompt:
          "Diese Sitzung hat ihr Kostenlimit erreicht. Erhöhe oder entferne das Limit, um fortzufahren.",
      },
    },
    approvalReasons: {
      failures: {
        noApprovalModel: "Es ist kein Freigabemodell konfiguriert.",
        noResponse: "Das Prüfmodell hat keine Antwort geliefert.",
        noRuling: "Das Prüfmodell hat keine Entscheidung abgegeben.",
        malformedRulings:
          "Die Entscheidungen des Prüfmodells waren fehlerhaft.",
        rulingCountMismatch:
          "Das Prüfmodell hat nicht genau eine Entscheidung pro Tool-Aufruf geliefert.",
        streamFailed: "Der Stream des Prüfmodells ist fehlgeschlagen.",
        omittedCall:
          "Das Prüfmodell hat diesen Tool-Aufruf in seinen Entscheidungen ausgelassen.",
      },
      autoReviewUnavailable: "Automatische Prüfung nicht verfügbar: {detail}",
      autoReviewerDenied:
        "Die automatische Prüfung hat diesen Aufruf abgelehnt.",
      escalationLimit:
        "Zu viele Eskalationen in diesem Durchgang; der Agent muss Aktion und Begründung überarbeiten, bevor er es erneut versucht.",
      authorizationUnclear:
        "Die Begründung belegt noch keine Berechtigung für diesen Aufruf; der Agent muss genauen Bedarf und Umfang erklären, bevor er es erneut versucht.",
    },
    approvalRequest: {
      autoApprovalFailed: "Automatische Freigabe fehlgeschlagen",
      autoApprovalFallback:
        "Die automatische Freigabe ist fehlgeschlagen. Bitte manuell prüfen.",
      title: "Freigabe erforderlich",
      triggerPreExecution:
        "Pine bittet vor der Ausführung dieses Vorgangs um Bestätigung.",
      triggerSandboxDenied:
        "Dieser Vorgang wurde von der Sandbox blockiert. Bei Freigabe wird er außerhalb der Sandbox erneut ausgeführt.",
      triggerAuthorizeDenied:
        "Dieser Vorgang greift auf einen Pfad außerhalb der mit Pine geteilten Ordner zu. Bei Freigabe wird er unabhängig von den Ordnerfreigaben ausgeführt.",
      triggerDestructivePattern:
        "Dieser Vorgang entspricht einem Muster für destruktive Befehle. Bitte prüfen Sie ihn vor der Ausführung.",
      triggerPrivilegedExecution:
        "Dieser Vorgang verlangt eine native Ausführung außerhalb der Projekt-Sandbox von Pine.",
      triggerLongContextActivation:
        "Pine möchte neue Tools aktivieren. Bitte bestätigen Sie das zuerst.",
      evidence: "Details",
      explanationLoading: "Das Freigabemodell beschreibt diesen Vorgang…",
      explanationNote:
        "Vom Freigabemodell verfasst. Ausgeführt werden die ursprünglichen Parameter.",
      risks: "Risiken",
      showParameters: "Ursprüngliche Parameter anzeigen",
      hideParameters: "Ursprüngliche Parameter ausblenden",
      approve: "Genehmigen",
      reject: "Ablehnen",
      activateNow: "Jetzt aktivieren",
      compactFirst: "Komprimieren, dann fortfahren",
      abortActivation: "Stoppen",
      activationTools: {
        activate_computer_use:
          "Computersteuerung: Pine kann Ihren Bildschirm sehen und Ihre Apps bedienen.",
        activate_skill_authoring:
          "Skill-Erstellung: Pine kann Skills erstellen und bearbeiten.",
        activate_automation_authoring:
          "Automatisierungen erstellen: Pine kann Automatisierungen erstellen und bearbeiten.",
        activate_mcp_authoring:
          "MCP-Verwaltung: Pine kann MCP-Server hinzufügen, ändern und entfernen.",
        activate_media_generation:
          "Mediengenerierung: Pine kann Bilder und Videos erzeugen.",
      },
      activationWhy:
        "Dieses Modell kann mitten in einer Unterhaltung keine neuen Tools aufnehmen. Die Aktivierung ändert den Anfang der Anfrage, sodass der vom Anbieter zwischengespeicherte Kontext von etwa {tokens} unbrauchbar wird.",
      activationNowEffect:
        "Jetzt aktivieren: In dieser Runde wird der gesamte Kontext zum vollen Preis neu verarbeitet, die Antwort ist langsamer und teurer. Danach funktioniert das Caching wieder normal.",
      activationCompactEffect:
        "Komprimieren, dann fortfahren: Die Unterhaltung wird zuerst zusammengefasst, danach werden die Tools aktiviert. Das Komprimieren nutzt den zwischengespeicherten Kontext und kostet meist deutlich weniger als eine Neuverarbeitung; spätere Runden sind kürzer und günstiger. Frühe Details können in der Zusammenfassung fehlen.",
      guide: "Mit Hinweis ablehnen",
    },
    questionnaireRequest: {
      progress: "Frage {current} von {total}",
      customAnswer: "Eigene Antwort eingeben…",
      required: "Wählen Sie eine Antwort, um fortzufahren.",
      previous: "Zurück",
      next: "Weiter",
      cancel: "Abbrechen",
      submit: "Absenden",
    },
    transcript: {
      copyMessage: "Nachricht kopieren",
      copyMessageFailed: "Die Nachricht konnte nicht kopiert werden",
      editMessage: "Nachricht bearbeiten",
      editMessageFailed:
        "Die bearbeitete Nachricht konnte nicht erneut gesendet werden",
      editMessageLabel: "Bearbeitete Nachricht",
      sendEditedMessage: "Senden",
      error: "Fehler",
      stopped: "Gestoppt",
      emptyDescription:
        "Beginnen Sie mit einer Frage, einer Aufgabe oder einer kühnen Idee.",
      emptyTitle: "Stellen Sie sich vor, was möglich ist",
      loadHistory: "Frühere Nachrichten laden",
      loadingHistory: "Wird geladen",
      outline: "Gliederung der Unterhaltung",
      outlineAttachments: "[Anhang]",
      outlineEmpty:
        "Ihre Beiträge erscheinen hier, sobald Sie eine Nachricht senden.",
      thinking: "Denkprozess",
      thinkingActive: "Denkt nach ({duration})",
      thinkingComplete: "Gearbeitet: {duration}",
      thinkingCompleteWithoutDuration: "Gearbeitet",
      thinkingDuration: {
        lessThanSecond: "<1 s",
        minutes: "{minutes} min {seconds} s",
        seconds: "{value} s",
      },
      sessionNotice: {
        finished: "Untersitzung {name} abgeschlossen",
        failed: "Untersitzung {name} fehlgeschlagen",
        awaitingApproval: "Untersitzung {name} wartet auf deine Freigabe",
        untitled: "Ohne Titel",
      },
      relay: {
        startedBy: "Gestartet von {name}",
        from: "Von {name}",
      },
      backgroundTask: {
        completed: "Hintergrundprozess {name} abgeschlossen",
        failed: "Hintergrundprozess {name} fehlgeschlagen",
        killed: "Hintergrundprozess {name} wurde beendet",
        running: "Hintergrundprozess {name} läuft",
      },
      compaction: {
        running: "Kontext wird verdichtet",
        complete: "Kontext verdichtet",
        error: "Kontextverdichtung fehlgeschlagen",
        aborted: "Kontextverdichtung abgebrochen",
      },
      toolSteps: {
        bash: {
          active: "{count} Befehle werden ausgeführt",
          complete: "{count} Befehle ausgeführt",
        },
        browser: {
          active: "{count} Browseraktionen werden verwendet",
          complete: "{count} Browseraktionen verwendet",
        },
        computer: {
          active: "{count} Computeraktionen werden verwendet",
          complete: "{count} Computeraktionen verwendet",
        },
        edit: {
          active: "{count} Dateien werden bearbeitet",
          complete: "{count} Dateien bearbeitet",
        },
        generic: {
          active: "{count} Werkzeuge werden verwendet",
          complete: "{count} Werkzeuge verwendet",
        },
        read: {
          active: "{count} Dateien werden gelesen",
          complete: "{count} Dateien gelesen",
        },
        fileSearch: {
          active: "Dateisuche läuft ({count}-mal)",
          complete: "{count}-mal Dateien durchsucht",
        },
        search: {
          active: "Suche läuft ({count}-mal)",
          complete: "{count}-mal gesucht",
        },
        recall: {
          active: "Verlauf wird durchsucht ({count}-mal)",
          complete: "Verlauf {count}-mal durchsucht",
        },
        fetch: {
          active: "{count} Webseiten werden abgerufen",
          complete: "{count} Webseiten abgerufen",
        },
        media: {
          active: "{count} Bilder werden erzeugt",
          complete: "{count} Bilder erzeugt",
        },
        mcp: {
          active: "{count} MCP-Vorgänge werden ausgeführt",
          complete: "{count} MCP-Vorgänge ausgeführt",
        },
        presentFile: {
          active: "{count} Dateien werden präsentiert",
          complete: "{count} Dateien präsentiert",
        },
        workbenchState: {
          active: "Status des Arbeitsbereichs wird geprüft",
          complete: "Status des Arbeitsbereichs geprüft",
        },
        workbench: {
          active: "Arbeitsbereich wird angeordnet",
          complete: "Arbeitsbereich angeordnet",
        },
        automation: {
          active: "{count} Automatisierungsaktionen laufen",
          complete: "{count} Automatisierungsaktionen ausgeführt",
        },
        model: {
          active: "Modelle werden {count}-mal abgefragt",
          complete: "Modelle {count}-mal abgefragt",
        },
        datetime: {
          active: "Uhrzeit wird {count}-mal abgefragt",
          complete: "Uhrzeit {count}-mal abgefragt",
        },
        mcpConfig: {
          active: "Konfiguriere MCP-Server ({count}×)",
          complete: "MCP-Server konfiguriert ({count}×)",
        },
        project: {
          active: "{count} Projektaktionen werden ausgeführt",
          complete: "{count} Projektaktionen ausgeführt",
        },
        session: {
          active: "{count} Sitzungsaktionen werden ausgeführt",
          complete: "{count} Sitzungsaktionen ausgeführt",
        },
        background: {
          active: "{count} Hintergrundprozesse werden verwaltet",
          complete: "{count} Hintergrundprozesse verwaltet",
        },
        todo: {
          active: "Aufgaben werden aktualisiert ({count}-mal)",
          complete: "Aufgaben {count}-mal aktualisiert",
        },
        write: {
          active: "{count} Dateien werden geschrieben",
          complete: "{count} Dateien geschrieben",
        },
        skill: {
          active: "{count} Skills werden verarbeitet",
          complete: "{count} Skills verarbeitet",
        },
      },
      automationRun: {
        started: "Automatisierungslauf",
      },
      toolKinds: {
        bash: "Befehlsausführung",
        browser: "Browseraktion",
        computer: "Computeraktion",
        edit: "Bearbeitung",
        generic: "Werkzeug",
        media: "Bilderzeugung",
        mcp: "MCP-Vorgang",
        read: "Lesen",
        search: "Suche",
        fileSearch: "Dateisuche",
        recall: "Verlaufssuche",
        fetch: "Webabruf",
        presentFile: "Dateipräsentation",
        workbench: "Änderung am Arbeitsbereich",
        workbenchState: "Status des Arbeitsbereichs",
        automation: "Automatisierungsaktion",
        model: "Modellabfrage",
        datetime: "Datum und Uhrzeit",
        mcpConfig: "MCP-Konfiguration",
        project: "Projektaktion",
        session: "Sitzungsaktion",
        background: "Hintergrundprozess",
        todo: "Aufgaben",
        skill: "Skill",
        write: "Schreiben",
      },
      toolParams: {
        invalidUrl: "ungültige URL",
        searchDomainTypeSuffix: "{value}",
        searchTypes: {
          web: "Web",
          news: "Nachrichten",
          researchPaper: "Forschungsarbeiten",
        },
        searchRecency: "letzte {value}",
        searchRecencyUnits: {
          days: "{count} T.",
          hours: "{count} Std.",
          minutes: "{count} Min.",
        },
        searchIncludedDomain: "Website {value}",
        searchMoreSites: "{count} weitere Websites",
        searchPage: "Seite {value}",
        fetchMoreUrls: "und {count} weitere Webseiten",
        fetchHighlights: "Highlights: {value}",
      },
      toolDetails: {
        reviewHistory: "Prüfverlauf",
        noReviewModel: "Genehmigungsmodell nicht verfügbar",
        reviewKinds: {
          decisions: "Decisions-Vorprüfung",
          model: "Genehmigungsmodell",
        },
        reviewOutcomes: {
          allow: "Erlaubt",
          deny: "Abgelehnt",
          needs_user: "Benutzerbestätigung erforderlich",
          fallback: "An das Prüfmodell weitergeleitet",
          error: "Prüfung fehlgeschlagen",
        },
        reviewReasons: {
          decisionsAllow:
            "Die Decisions-Vorprüfung hat diese Aktion als autorisiert und zulässig eingestuft.",
          decisionsNeedsUser:
            "Die Decisions-Vorprüfung bittet Sie, Berechtigung und Risiken dieser Aktion zu bestätigen.",
          decisionsModelReview:
            "Decisions hat eine ausführliche Prüfung durch das Modell angefordert.",
          decisionsNoAnswer:
            "Decisions hat für diesen Werkzeugaufruf keine gültige Antwort geliefert.",
          decisionsNoApiKey:
            "Für die Decisions-Vorprüfung ist kein OpenRouter-API-Schlüssel verfügbar.",
        },
        title: "Details des Werkzeugaufrufs",
        description:
          "Sehen Sie sich Status, Parameter und Ergebnis dieses Werkzeugaufrufs an.",
        status: "Ausführungsstatus",
        approval: "Freigabestatus",
        tool: "Werkzeug",
        callId: "Aufruf-ID",
        duration: "Dauer",
        durationMilliseconds: "{value} ms",
        durationSeconds: "{value} s",
        parameters: "LLM-Parameter",
        result: "Werkzeugergebnis",
        field: "Feld",
        value: "Wert",
        rootValue: "Ergebnis",
        circularValue: "Zirkulärer Verweis kann nicht angezeigt werden",
        rejectionReason: "Ablehnungsgrund",
        noParameters: "Keine Parameter",
        noResult: "Noch kein Ergebnis",
        editHunk: "Änderung {count}",
        webPage: "Seite",
        webSnippet: "Ausschnitt",
        question: "Frage",
        answer: "Antwort",
        file: "Datei",
        line: "Zeile",
        match: "Treffer",
        moreResults:
          "Es gibt weitere Ergebnisse; der Agent kann dort fortfahren, wo die Suche endete.",
        format: "Format",
        kind: "Art",
        imageResult: "Bildergebnis",
        multipleChoice: "Mehrfachauswahl",
        embeddedImage: "Eingebettetes Bild",
        statuses: {
          pending: "Ausstehend",
          running: "Läuft",
          complete: "Abgeschlossen",
          error: "Fehlgeschlagen",
          reviewing: "Automatische Freigabe läuft",
          awaitingApproval: "Wartet auf Freigabe durch den Benutzer",
          autoApprovalDenied: "Von der automatischen Freigabe abgelehnt",
          userApprovalDenied: "Vom Benutzer abgelehnt",
          sandboxDenied: "Von der Sandbox abgelehnt",
        },
        approvals: {
          awaitingApproval: "Wartet auf Freigabe durch den Benutzer",
          autoApproved: "Automatisch genehmigt",
          autoDenied: "Automatisch abgelehnt",
          userApproved: "Vom Benutzer genehmigt",
          userDenied: "Vom Benutzer abgelehnt",
          sandboxDenied: "Von der Sandbox abgelehnt",
        },
      },
      tools: {
        operationSeparator: ": ",
        activateComputerUse: {
          complete: "Computersteuerung aktiviert",
          error: "Computersteuerung konnte nicht aktiviert werden",
          running: "Computersteuerung wird aktiviert",
          awaiting:
            "Wartet auf Ihre Auswahl, bevor die Computersteuerung aktiviert wird",
          denied: "Computersteuerung nicht aktiviert",
        },
        activatePineOps: {
          complete: "Pine-Vorgänge aktiviert",
          error: "Pine-Vorgänge konnten nicht aktiviert werden",
          running: "Pine-Vorgänge werden aktiviert",
        },
        questionnaire: {
          complete: "Antworten auf {count} Fragen erhalten",
          error: "Die Fragen konnten nicht vorbereitet werden",
          running: "Einige Fragen werden vorbereitet",
        },
        presentFile: {
          complete: "Präsentiert: ",
          error: "Präsentation fehlgeschlagen: ",
          running: "Präsentiert: ",
        },
        workbench: {
          state: {
            complete: "Status des Arbeitsbereichs geprüft",
            error: "Status des Arbeitsbereichs konnte nicht geprüft werden",
            running: "Status des Arbeitsbereichs wird geprüft",
          },
          open: {
            complete: "{panel} im Arbeitsbereich angezeigt",
            error: "{panel} konnte im Arbeitsbereich nicht angezeigt werden",
            running: "{panel} wird im Arbeitsbereich angezeigt",
          },
          closeCard: {
            complete: "Karte {panel} geschlossen",
            error: "Karte {panel} konnte nicht geschlossen werden",
            running: "Karte {panel} wird geschlossen",
          },
          close: {
            complete: "Arbeitsbereich geschlossen",
            error: "Arbeitsbereich konnte nicht geschlossen werden",
            running: "Arbeitsbereich wird geschlossen",
          },
          arrange: {
            complete: "Arbeitsbereich angeordnet: {top} oben, {bottom} unten",
            completeSingle:
              "Arbeitsbereich so angeordnet, dass nur {panel} angezeigt wird",
            error: "Arbeitsbereich konnte nicht angeordnet werden",
            running: "Arbeitsbereich wird angeordnet",
          },
        },
        automation: {
          activate: {
            running: "Automatisierungswerkzeuge werden geladen",
            complete: "Automatisierungswerkzeuge geladen",
            error: "Automatisierungswerkzeuge konnten nicht geladen werden",
          },
          list: {
            running: "Automatisierungen werden aufgelistet",
            complete: "Automatisierungen aufgelistet",
            error: "Automatisierungen konnten nicht aufgelistet werden",
          },
          get: {
            running: "Automatisierung wird gelesen: ",
            complete: "Automatisierung gelesen: ",
            error: "Automatisierung konnte nicht gelesen werden: ",
          },
          check: {
            running: "Automatisierung wird geprüft: ",
            complete: "Automatisierung geprüft: ",
            error: "Automatisierung konnte nicht geprüft werden: ",
          },
          create: {
            running: "Automatisierung wird erstellt: ",
            complete: "Automatisierung erstellt: ",
            error: "Automatisierung konnte nicht erstellt werden: ",
          },
          update: {
            running: "Automatisierung wird aktualisiert: ",
            complete: "Automatisierung aktualisiert: ",
            error: "Automatisierung konnte nicht aktualisiert werden: ",
          },
          pause: {
            running: "Automatisierung wird pausiert: ",
            complete: "Automatisierung pausiert: ",
            error: "Automatisierung konnte nicht pausiert werden: ",
          },
          resume: {
            running: "Automatisierung wird fortgesetzt: ",
            complete: "Automatisierung fortgesetzt: ",
            error: "Automatisierung konnte nicht fortgesetzt werden: ",
          },
          runNow: {
            running: "Automatisierung wird gestartet: ",
            complete: "Automatisierung gestartet: ",
            error: "Automatisierung konnte nicht gestartet werden: ",
          },
          delete: {
            running: "Automatisierung wird gelöscht: ",
            complete: "Automatisierung gelöscht: ",
            error: "Automatisierung konnte nicht gelöscht werden: ",
          },
          report: {
            running: "Ergebnis des Laufs wird gemeldet",
            complete: "Neue Ergebnisse gemeldet: ",
            nothing: "Nichts Neues gemeldet: ",
            error: "Ergebnis des Laufs konnte nicht gemeldet werden",
          },
        },
        model: {
          list: {
            running: "Verfügbare Modelle werden abgefragt",
            complete: "Verfügbare Modelle abgefragt",
            error: "Modelle konnten nicht aufgelistet werden",
          },
        },
        datetime: {
          running: "Datum und Uhrzeit werden abgefragt",
          complete: "Datum und Uhrzeit abgefragt",
          error: "Datum und Uhrzeit konnten nicht abgefragt werden",
        },
        mcpConfig: {
          activate: {
            running: "Lade MCP-Konfigurationswerkzeuge",
            complete: "MCP-Konfigurationswerkzeuge geladen",
            error: "MCP-Konfigurationswerkzeuge konnten nicht geladen werden",
          },
          list: {
            running: "Liste MCP-Server auf",
            complete: "MCP-Server aufgelistet",
            error: "MCP-Server konnten nicht aufgelistet werden",
          },
          create: {
            running: "Füge MCP-Server hinzu: ",
            complete: "MCP-Server hinzugefügt: ",
            error: "MCP-Server konnte nicht hinzugefügt werden: ",
          },
          update: {
            running: "Aktualisiere MCP-Server ",
            complete: "MCP-Server aktualisiert: ",
            error: "MCP-Server konnte nicht aktualisiert werden: ",
          },
          enable: {
            running: "Aktiviere MCP-Server ",
            complete: "MCP-Server aktiviert: ",
            error: "MCP-Server konnte nicht aktiviert werden: ",
          },
          disable: {
            running: "Deaktiviere MCP-Server ",
            complete: "MCP-Server deaktiviert: ",
            error: "MCP-Server konnte nicht deaktiviert werden: ",
          },
          remove: {
            running: "Entferne MCP-Server ",
            complete: "MCP-Server entfernt: ",
            error: "MCP-Server konnte nicht entfernt werden: ",
          },
        },
        project: {
          list: {
            complete: "Projekte aufgelistet",
            error: "Projekte konnten nicht aufgelistet werden",
            running: "Projekte werden aufgelistet",
          },
          teleport: {
            complete: "Zu Projekt gewechselt: ",
            declined: "Nicht zu Projekt gewechselt: ",
            error: "Wechsel zu Projekt fehlgeschlagen: ",
            running: "Wechsel zu Projekt wird angefragt: ",
          },
          create: {
            running: "Erstelle Projekt ",
            complete: "Projekt erstellt: ",
            declined: "Projekt nicht erstellt: ",
            error: "Projekt konnte nicht erstellt werden: ",
          },
          update: {
            running: "Bearbeite Projekt ",
            complete: "Projekt bearbeitet: ",
            declined: "Projekt nicht bearbeitet: ",
            error: "Projekt konnte nicht bearbeitet werden: ",
          },
          delete: {
            running: "Lösche Projekt ",
            complete: "Projekt gelöscht: ",
            declined: "Projekt nicht gelöscht: ",
            error: "Projekt konnte nicht gelöscht werden: ",
          },
        },
        session: {
          search: {
            running: "Durchsuche Sitzungen nach ",
            complete: "Sitzungen durchsucht nach ",
            error: "Sitzungen konnten nicht durchsucht werden: ",
          },
          recent: {
            running: "Liste letzte Sitzungen auf",
            complete: "Letzte Sitzungen aufgelistet",
            error: "Sitzungen konnten nicht aufgelistet werden",
          },
          new: {
            running: "Starte eine Sitzung",
            complete: "Sitzung gestartet in ",
            declined: "Keine Sitzung gestartet",
            error: "Sitzung konnte nicht gestartet werden",
          },
          tree: {
            running: "Lese Sitzungsordner von ",
            complete: "Sitzungsordner gelesen: ",
            error: "Sitzungsordner konnten nicht gelesen werden: ",
          },
          organize: {
            running: "Ordne Sitzungen in ",
            complete: "Sitzungen geordnet: ",
            declined: "Sitzungen nicht geordnet: ",
            error: "Sitzungen konnten nicht geordnet werden: ",
          },
          rename: {
            running: "Benenne Sitzung um in ",
            complete: "Sitzung umbenannt in ",
            kept: "Sitzungstitel beibehalten",
            error: "Sitzung konnte nicht umbenannt werden",
          },
          relatives: {
            running: "Liste verwandte Sitzungen auf",
            complete: "Verwandte Sitzungen aufgelistet",
            error: "Verwandte Sitzungen konnten nicht aufgelistet werden",
          },
          read: {
            running: "Lese Sitzung ",
            complete: "Sitzung gelesen: ",
            error: "Sitzung konnte nicht gelesen werden: ",
          },
          send: {
            running: "Sende Nachricht an Sitzung ",
            complete: "Nachricht gesendet an Sitzung ",
            error: "Nachricht an Sitzung fehlgeschlagen: ",
          },
          delete: {
            running: "Lösche eine Sitzung",
            complete: "Sitzung gelöscht: ",
            declined: "Sitzung nicht gelöscht",
            error: "Sitzung konnte nicht gelöscht werden",
          },
        },
        background: {
          run: {
            running: "Hintergrundprozess wird gestartet: ",
            complete: "Hintergrundprozess gestartet: ",
            error: "Hintergrundprozess konnte nicht gestartet werden: ",
          },
          status: {
            running: "Hintergrundprozesse werden geprüft",
            complete: "Hintergrundprozesse geprüft",
            error: "Hintergrundprozesse konnten nicht geprüft werden",
          },
          logs: {
            running: "Ausgabe wird gelesen: ",
            complete: "Ausgabe gelesen: ",
            error: "Ausgabe konnte nicht gelesen werden: ",
          },
          kill: {
            running: "Wird beendet: ",
            complete: "Beendet: ",
            error: "Konnte nicht beendet werden: ",
          },
        },
        todo: {
          create: {
            running: "Aufgabe wird hinzugefügt: ",
            complete: "Aufgabe hinzugefügt: ",
          },
          start: {
            running: "Aufgabe wird gestartet: ",
            complete: "Aufgabe gestartet: ",
          },
          complete: {
            running: "Aufgabe wird abgeschlossen: ",
            complete: "Aufgabe abgeschlossen: ",
          },
          reopen: {
            running: "Wird auf „Offen“ zurückgesetzt: ",
            complete: "Auf „Offen“ zurückgesetzt: ",
          },
          update: {
            running: "Aufgabe wird aktualisiert: ",
            complete: "Aufgabe aktualisiert: ",
          },
          delete: {
            running: "Aufgabe wird gelöscht: ",
            complete: "Aufgabe gelöscht: ",
          },
          get: {
            running: "Aufgabe wird gelesen: ",
            complete: "Aufgabe gelesen: ",
          },
          list: {
            running: "Aufgaben werden gelesen",
            complete: "Aufgaben gelesen",
          },
          clear: {
            running: "Aufgaben werden geleert",
            complete: "Aufgaben geleert",
          },
          error: "Aufgabenänderung abgelehnt: ",
        },
        reviewing: "{tool} wird geprüft: ",
        writeLines: "({count} Zeilen)",
        denied: "{tool} abgelehnt: ",
        awaitingApproval:
          "Wartet auf Ihre Freigabe für diesen Vorgang ({tool}): ",
        skillScopes: {
          global: "global",
          project: "Projekt",
        },
        skillOperations: {
          activateAuthoring: {
            label: "Skill-Erstellung aktivieren",
            complete: "Skill-Erstellung aktiviert",
            running: "Skill-Erstellung wird aktiviert",
            error: "Skill-Erstellung konnte nicht aktiviert werden",
          },
          invoke: {
            label: "einen Skill aufrufen",
            complete: "Skill aufgerufen",
            running: "Skill wird aufgerufen",
            error: "Skill konnte nicht aufgerufen werden",
          },
          listResources: {
            label: "Skill-Ressourcen auflisten",
            complete: "Skill-Ressourcen aufgelistet",
            running: "Skill-Ressourcen werden aufgelistet",
            error: "Skill-Ressourcen konnten nicht aufgelistet werden",
          },
          readResource: {
            label: "eine Skill-Ressource lesen",
            complete: "Skill-Ressource gelesen",
            running: "Skill-Ressource wird gelesen",
            error: "Skill-Ressource konnte nicht gelesen werden",
          },
          create: {
            label: "einen Skill erstellen",
            complete: "Skill ({scope}) erstellt",
            running: "Skill ({scope}) wird erstellt",
            error: "Skill ({scope}) konnte nicht erstellt werden",
          },
          edit: {
            label: "einen Skill bearbeiten",
            complete: "Skill ({scope}) bearbeitet",
            running: "Skill ({scope}) wird bearbeitet",
            error: "Skill ({scope}) konnte nicht bearbeitet werden",
          },
          remove: {
            label: "einen Skill entfernen",
            complete: "Skill ({scope}) entfernt",
            running: "Skill ({scope}) wird entfernt",
            error: "Skill ({scope}) konnte nicht entfernt werden",
          },
        },
        mediaOperations: {
          activateMediaGeneration: {
            label: "Medienerzeugung aktivieren",
            complete: "Medienerzeugung aktiviert",
            running: "Medienerzeugung wird aktiviert",
            error: "Medienerzeugung konnte nicht aktiviert werden",
          },
          generateImage: {
            label: "ein Bild erzeugen",
            complete: "Bild erzeugt",
            running: "Bild wird erzeugt",
            error: "Bild konnte nicht erzeugt werden",
          },
          generateVideo: {
            saved: "Video gespeichert",
            pending: "Video eingereiht",
            inProgress: "Videoerzeugung läuft",
            label: "ein Video erzeugen",
            complete: "Videoerzeugung übermittelt",
            running: "Video wird erzeugt",
            error: "Video konnte nicht erzeugt werden",
          },
          listVideoModels: {
            label: "Videomodelle ansehen",
            complete: "Videomodelle angesehen",
            running: "Videomodelle werden angesehen",
            error: "Videomodelle konnten nicht angesehen werden",
          },
          getVideoGeneration: {
            saved: "Video gespeichert",
            pending: "Video eingereiht",
            inProgress: "Videoerzeugung läuft",
            label: "Videoerzeugung prüfen",
            complete: "Videoerzeugung geprüft",
            running: "Videoerzeugung wird geprüft",
            error: "Videoerzeugung konnte nicht geprüft werden",
          },
        },
        bash: {
          complete: { before: "Ausgeführt: ", after: "" },
          error: { before: "Ausführung fehlgeschlagen: ", after: "" },
          running: { before: "Wird ausgeführt: ", after: "" },
        },
        browser: {
          complete: { before: "Browseraktion verwendet: ", after: "" },
          error: { before: "Browseraktion fehlgeschlagen: ", after: "" },
          running: { before: "Browseraktion wird verwendet: ", after: "" },
        },
        computer: {
          complete: { before: "Computeraktion verwendet: ", after: "" },
          error: { before: "Computeraktion fehlgeschlagen: ", after: "" },
          running: { before: "Computeraktion wird verwendet: ", after: "" },
        },
        computerOperations: {
          screen: "den Bildschirm",
          requestPermissions: {
            label: "Systemberechtigungen anfordern",
            complete: "Systemberechtigungen angefordert",
            running: "Systemberechtigungen werden angefordert",
            error: "Systemberechtigungen konnten nicht angefordert werden",
          },
          installExtension: {
            label: "die Browsererweiterung installieren",
            complete: "Browsererweiterung installiert",
            running: "Browsererweiterung wird installiert",
            error: "Browsererweiterung konnte nicht installiert werden",
          },
          listApps: {
            label: "geöffnete Apps ansehen",
            complete: "Geöffnete Apps angesehen",
            running: "Geöffnete Apps werden angesehen",
            error: "Geöffnete Apps konnten nicht angesehen werden",
          },
          getAppState: {
            label: "App-Status ansehen",
            complete: "Status der App {app} angesehen",
            completeNoApp: "App-Status angesehen",
            running: "Status der App {app} wird angesehen",
            runningNoApp: "App-Status wird angesehen",
            error: "Status der App {app} konnte nicht angesehen werden",
            errorNoApp: "App-Status konnte nicht angesehen werden",
          },
          click: {
            label: "auf ein Oberflächenelement klicken",
            complete: "In der Oberfläche auf {target} geklickt",
            completeNoTarget: "In die Oberfläche geklickt",
            running: "In der Oberfläche wird auf {target} geklickt",
            runningNoTarget: "In die Oberfläche wird geklickt",
            error:
              "In der Oberfläche konnte nicht auf {target} geklickt werden",
            errorNoTarget: "In die Oberfläche konnte nicht geklickt werden",
          },
          typeText: {
            label: "Text eingeben",
            complete: "Text eingegeben",
            running: "Text wird eingegeben",
            error: "Text konnte nicht eingegeben werden",
          },
          pressKey: {
            label: "eine Taste drücken",
            complete: "Taste gedrückt",
            running: "Taste wird gedrückt",
            error: "Taste konnte nicht gedrückt werden",
          },
          scroll: {
            label: "die Oberfläche scrollen",
            complete: "Oberfläche gescrollt",
            running: "Oberfläche wird gescrollt",
            error: "Oberfläche konnte nicht gescrollt werden",
          },
          activateApp: {
            label: "zu einer App wechseln",
            complete: "Zu {app} gewechselt",
            completeNoApp: "Zu einer App gewechselt",
            running: "Wechsel zu {app}",
            runningNoApp: "Wechsel zu einer App",
            error: "Wechsel zu {app} fehlgeschlagen",
            errorNoApp: "Wechsel zu einer App fehlgeschlagen",
          },
          screenshot: {
            label: "den Bildschirm aufnehmen",
            complete: "Screenshot von {app} aufgenommen und geprüft",
            completeNoApp: "Screenshot aufgenommen und geprüft",
            running: "Screenshot von {app} wird aufgenommen und geprüft",
            runningNoApp: "Screenshot wird aufgenommen und geprüft",
            error: "Screenshot von {app} konnte nicht aufgenommen werden",
            errorNoApp:
              "Screenshot konnte nicht aufgenommen und geprüft werden",
          },
          listDisplays: {
            label: "Displays ansehen",
            complete: "Displays angesehen",
            running: "Displays werden angesehen",
            error: "Displays konnten nicht angesehen werden",
          },
          rightClick: {
            label: "ein Oberflächenelement per Rechtsklick öffnen",
            complete: "Rechtsklick auf ein Oberflächenelement ausgeführt",
            running: "Rechtsklick auf ein Oberflächenelement wird ausgeführt",
            error: "Rechtsklick auf das Oberflächenelement fehlgeschlagen",
          },
          drag: {
            label: "ein Oberflächenelement ziehen",
            complete: "Oberflächenelement gezogen",
            running: "Oberflächenelement wird gezogen",
            error: "Oberflächenelement konnte nicht gezogen werden",
          },
          setValue: {
            label: "einen Feldwert setzen",
            complete: "Feldwert gesetzt",
            running: "Feldwert wird gesetzt",
            error: "Feldwert konnte nicht gesetzt werden",
          },
          browserOpenTab: {
            label: "einen Browser-Tab öffnen",
            complete: "Browser-Tab geöffnet",
            running: "Browser-Tab wird geöffnet",
            error: "Browser-Tab konnte nicht geöffnet werden",
          },
          browserListTabs: {
            label: "Browser-Tabs ansehen",
            complete: "Browser-Tabs angesehen",
            running: "Browser-Tabs werden angesehen",
            error: "Browser-Tabs konnten nicht angesehen werden",
          },
          browserUseTab: {
            label: "einen Browser-Tab verwenden",
            complete: "Browser-Tab verwendet",
            running: "Browser-Tab wird verwendet",
            error: "Browser-Tab konnte nicht verwendet werden",
          },
          browserReleaseTab: {
            label: "einen Browser-Tab freigeben",
            complete: "Browser-Tab freigegeben",
            running: "Browser-Tab wird freigegeben",
            error: "Browser-Tab konnte nicht freigegeben werden",
          },
          browserSelectTab: {
            label: "Browser-Tabs wechseln",
            complete: "Browser-Tab gewechselt",
            running: "Browser-Tab wird gewechselt",
            error: "Browser-Tab konnte nicht gewechselt werden",
          },
          browserCloseTab: {
            label: "einen Browser-Tab schließen",
            complete: "Browser-Tab geschlossen",
            running: "Browser-Tab wird geschlossen",
            error: "Browser-Tab konnte nicht geschlossen werden",
          },
          browserSnapshot: {
            label: "die Webseite ansehen",
            complete: "Webseite {target} angesehen",
            completeNoTarget: "Webseite angesehen",
            running: "Webseite {target} wird angesehen",
            runningNoTarget: "Webseite wird angesehen",
            error: "Webseite {target} konnte nicht angesehen werden",
            errorNoTarget: "Webseite konnte nicht angesehen werden",
          },
          browserClick: {
            label: "auf ein Webseitenelement klicken",
            complete: "Auf ein Webseitenelement geklickt",
            running: "Auf ein Webseitenelement wird geklickt",
            error: "Auf das Webseitenelement konnte nicht geklickt werden",
          },
          browserType: {
            label: "in die Webseite eingeben",
            complete: "In die Webseite eingegeben",
            running: "In die Webseite wird eingegeben",
            error: "In die Webseite konnte nicht eingegeben werden",
          },
          browserPressKey: {
            label: "eine Taste auf der Webseite drücken",
            complete: "Taste auf der Webseite gedrückt",
            running: "Taste auf der Webseite wird gedrückt",
            error: "Taste auf der Webseite konnte nicht gedrückt werden",
          },
          browserCloseAllTabs: {
            label: "alle Browser-Tabs schließen",
            complete: "Alle Browser-Tabs geschlossen",
            running: "Alle Browser-Tabs werden geschlossen",
            error: "Nicht alle Browser-Tabs konnten geschlossen werden",
          },
          browserNavigate: {
            label: "zu einer Webseite navigieren",
            complete: "Zu einer Webseite navigiert",
            running: "Navigation zu einer Webseite",
            error: "Navigation zur Webseite fehlgeschlagen",
          },
          zoom: {
            label: "die Oberfläche zoomen",
            complete: "Oberfläche gezoomt",
            running: "Oberfläche wird gezoomt",
            error: "Oberfläche konnte nicht gezoomt werden",
          },
          hover: {
            label: "mit dem Zeiger über ein Element fahren",
            complete: "Mit dem Zeiger über ein Element gefahren",
            running: "Zeiger wird über ein Element bewegt",
            error: "Zeiger konnte nicht über das Element bewegt werden",
          },
          wait: {
            label: "auf die Oberfläche warten",
            complete: "Auf die Oberfläche gewartet",
            running: "Wartet auf die Oberfläche",
            error: "Warten auf die Oberfläche fehlgeschlagen",
          },
          selectText: {
            label: "Text auswählen",
            complete: "Text ausgewählt",
            running: "Text wird ausgewählt",
            error: "Text konnte nicht ausgewählt werden",
          },
        },
        edit: {
          complete: { before: "Bearbeitet: ", after: "" },
          error: { before: "Bearbeiten fehlgeschlagen: ", after: "" },
          running: { before: "Wird bearbeitet: ", after: "" },
        },
        generic: {
          complete: { before: "Verwendet: ", after: "" },
          error: { before: "Fehlgeschlagen: ", after: "" },
          running: { before: "Wird verwendet: ", after: "" },
        },
        mcp: {
          complete: "MCP ausgeführt ({operation})",
          error: "MCP fehlgeschlagen ({operation})",
          running: "MCP wird ausgeführt ({operation})",
          operations: {
            call: "Werkzeugaufruf",
            search: "Werkzeugsuche",
            connect: "Serververbindung",
            describe: "Werkzeugabfrage",
            instructions: "Anweisungsabfrage",
            action: "Aktion",
            script: "Skript",
            status: "Statusprüfung",
          },
        },
        read: {
          complete: { before: "Gelesen: ", after: "" },
          error: { before: "Lesen fehlgeschlagen: ", after: "" },
          running: { before: "Wird gelesen: ", after: "" },
        },
        fileSearch: {
          find: {
            running: { before: "Suche Dateien für: ", after: "" },
            complete: { before: "Dateien gefunden für: ", after: "" },
            error: { before: "Dateisuche fehlgeschlagen: ", after: "" },
          },
          grep: {
            running: { before: "Durchsuche Inhalte nach: ", after: "" },
            complete: { before: "Inhalte durchsucht nach: ", after: "" },
            error: { before: "Inhaltssuche fehlgeschlagen: ", after: "" },
          },
          found: " · {count} gefunden",
          none: " · nichts gefunden",
        },
        search: {
          complete: { before: "Gesucht nach: ", after: "" },
          error: { before: "Suche fehlgeschlagen: ", after: "" },
          running: { before: "Suche nach: ", after: "" },
        },
        recall: {
          complete: { before: "Verlauf durchsucht nach: ", after: "" },
          error: { before: "Verlaufssuche fehlgeschlagen: ", after: "" },
          running: { before: "Verlauf wird durchsucht nach: ", after: "" },
        },
        recallTargets: {
          recent: "neueste Einträge",
          touched: "geänderte Dateien",
        },
        fetch: {
          complete: { before: "Abgerufen: ", after: "" },
          error: { before: "Abruf fehlgeschlagen: ", after: "" },
          running: { before: "Wird abgerufen: ", after: "" },
        },
        write: {
          complete: { before: "Geschrieben: ", after: "" },
          error: { before: "Schreiben fehlgeschlagen: ", after: "" },
          running: { before: "Wird geschrieben: ", after: "" },
        },
      },
    },
    files: {
      open: "Öffnen",
      reveal: "Im Dateimanager anzeigen",
      copyPath: "Pfad kopieren",
      newFolder: "Neuer Ordner",
      rename: "Umbenennen",
      trash: "In den Papierkorb verschieben",
      refresh: "Aktualisieren",
      name: "Name",
      nameDescription: "Geben Sie einen Datei- oder Ordnernamen ein.",
      trashDescription: "„{name}“ in den System-Papierkorb verschieben?",
      operationFailed: "Dateivorgang fehlgeschlagen",
      loading: "Wird geladen",
      emptyTitle: "Keine zugänglichen Ordner",
      emptyDescription:
        "Fügen Sie in den Projekteinstellungen einen Ordner hinzu.",
    },
  },
  quickComposer: {
    permission: {
      screen: "Pine das Erfassen des Fensters der aktuellen App erlauben",
      accessibility:
        "Pine das Lesen von Fenstertitel und ausgewähltem Text der aktuellen App erlauben",
      both: "Pine das Erfassen der aktuellen App und das Lesen ihres ausgewählten Texts erlauben",
    },
    openSettings: "Einstellungen öffnen",
  },
  webSignIn: {
    title: "Bei Pine anmelden",
    description: "Geben Sie Ihr Fernsteuerungs-Passwort ein.",
    password: "Passwort",
    submit: "Weiter",
    signingIn: "Anmeldung läuft…",
    "wrong-password": "Dieses Passwort ist falsch.",
    locked: "Zu viele Versuche. Versuchen Sie es in {seconds} s erneut.",
    unavailable: "Pine ist nicht erreichbar. Prüfen Sie, ob es noch läuft.",
  },
  errors: {
    skills: {
      title: "Skills konnten nicht aktualisiert werden",
      description:
        "Prüfen Sie den Skill-Namen und das Frontmatter der SKILL.md und versuchen Sie es erneut",
    },
    customModel: {
      title: "Eigenes Modell konnte nicht hinzugefügt werden",
      description:
        "Prüfen Sie Endpunkt und Modelleinstellungen und versuchen Sie es erneut",
    },
    customProvider: {
      title: "Eigener Anbieter konnte nicht aktualisiert werden",
      description:
        "Prüfen Sie den Endpunkt des Anbieters und versuchen Sie es erneut",
    },
    customDelete: {
      title: "Eigene Konfiguration konnte nicht gelöscht werden",
      description:
        "Der eigene Anbieter oder das eigene Modell wurde nicht gelöscht. Versuchen Sie es erneut",
    },
    modelMetadata: {
      title: "Modellmetadaten konnten nicht automatisch ausgefüllt werden",
      description:
        "Prüfen Sie die Modell-ID oder geben Sie die vollständige Anbieter-/Modell-ID ein und versuchen Sie es erneut",
    },
    contextCompaction: {
      title: "Kontext konnte nicht verdichtet werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    autoApprovalSettings: {
      title:
        "Einstellungen zur automatischen Freigabe konnten nicht aktualisiert werden",
      description: "Bitte versuchen Sie es später erneut.",
    },
    contextCompactionStrategy: {
      title:
        "Strategie zur Kontextverdichtung konnte nicht aktualisiert werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    contextCompactionRoute: {
      title: "Methode der Kontextverdichtung konnte nicht aktualisiert werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    remoteControl: {
      loadTitle: "Fernsteuerungseinstellungen konnten nicht geladen werden",
      saveTitle: "Browserzugriff konnte nicht aktualisiert werden",
      description: "Bitte versuchen Sie es später erneut.",
      portInUse:
        "Port {port} wird bereits verwendet. Wählen Sie einen anderen Port.",
      passwordTitle: "Zugriffspasswort konnte nicht gespeichert werden",
      signOutTitle: "Browser konnten nicht abgemeldet werden",
    },
    relayRemote: {
      loadTitle: "Fernsteuerungseinstellungen konnten nicht geladen werden",
      saveTitle: "Fernsteuerung konnte nicht aktualisiert werden",
      pairTitle: "Kopplungscode konnte nicht erstellt werden",
      deviceTitle: "Dieses Gerät konnte nicht aktualisiert werden",
      description: "Bitte versuchen Sie es später erneut.",
    },
    wechatRemote: {
      loadTitle: "WeChat-Einstellungen können nicht geladen werden",
      saveTitle: "WeChat-Einstellungen können nicht aktualisiert werden",
      connectTitle: "WeChat kann nicht verbunden werden",
      codeTitle: "Der Code kann nicht gesendet werden",
      disconnectTitle: "WeChat kann nicht getrennt werden",
      description: "Bitte versuche es später erneut.",
    },
    quickComposer: {
      title:
        "Einstellungen der Schnelleingabe konnten nicht aktualisiert werden",
      description: "Bitte versuchen Sie es später erneut.",
    },
    runInBackground: {
      title: "Hintergrundeinstellung konnte nicht aktualisiert werden",
      description: "Bitte versuchen Sie es später erneut.",
    },
    approximateLocation: {
      title:
        "Einstellungen zum ungefähren Standort konnten nicht aktualisiert werden",
      description: "Bitte versuchen Sie es später erneut.",
    },
    quickComposerShortcutTaken: {
      title: "Tastenkürzel nicht verfügbar",
      description:
        "Eine andere App verwendet bereits {shortcut}. Beenden Sie diese App oder ändern Sie ihr Tastenkürzel und versuchen Sie es erneut.",
    },
    completionSignal: {
      title:
        "Einstellungen des Abschlusssignals konnten nicht aktualisiert werden",
      description: "Bitte versuchen Sie es später erneut.",
    },
    attentionNotifications: {
      title:
        "Benachrichtigungseinstellungen für Freigaben und Fragen konnten nicht aktualisiert werden",
      description: "Bitte versuchen Sie es später erneut.",
    },
    diagnosticLogging: {
      title:
        "Einstellungen der Diagnoseprotokollierung konnten nicht aktualisiert werden",
      description: "Bitte versuchen Sie es später erneut.",
    },
    utilityModel: {
      title: "Hilfsmodell konnte nicht aktualisiert werden",
      description: "Prüfen Sie den Modellanbieter und versuchen Sie es erneut",
    },
    approvalModel: {
      title: "Freigabemodell konnte nicht aktualisiert werden",
      description: "Prüfen Sie den Modellanbieter und versuchen Sie es erneut",
    },
    imageModel: {
      title: "Bildmodell konnte nicht aktualisiert werden",
      description:
        "Prüfen Sie die OpenRouter-Zugangsdaten und versuchen Sie es erneut",
    },
    videoModel: {
      title: "Videomodell konnte nicht aktualisiert werden",
      description:
        "Prüfen Sie die OpenRouter-Zugangsdaten und versuchen Sie es erneut",
    },
    providerDisconnect: {
      title: "Anbieter konnte nicht getrennt werden",
      description:
        "Die Zugangsdaten wurden nicht gelöscht. Versuchen Sie es gleich noch einmal",
    },
    tinyFishCredentials: {
      title: "TinyFish-Schlüssel konnte nicht gespeichert werden",
      description:
        "Prüfen Sie, ob der sichere Anmeldedatenspeicher des Systems verfügbar ist, und versuchen Sie es erneut",
    },
    userProfile: {
      title: "Benutzerprofil konnte nicht gespeichert werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    modelCatalogRefresh: {
      title: "Modellkataloge konnten nicht aktualisiert werden",
      description:
        "Prüfen Sie Ihre Netzwerkverbindung und versuchen Sie es erneut",
    },
    projectList: {
      title: "Projekte konnten nicht geladen werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    projectClose: {
      title: "Projekt konnte nicht geschlossen werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    projectCreate: {
      title: "Projekt konnte nicht erstellt werden",
      description: "Prüfen Sie Namen und Ordner und versuchen Sie es erneut",
    },
    projectUpdate: {
      title: "Projekt konnte nicht aktualisiert werden",
      description: "Prüfen Sie, ob die ausgewählten Ordner zugänglich sind",
    },
    projectOpen: {
      title: "Projekt konnte nicht geöffnet werden",
      description:
        "Der Standardordner wurde möglicherweise verschoben oder ist nicht mehr verfügbar",
    },
    projectDelete: {
      title: "Projekt konnte nicht gelöscht werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    sessionSearch: {
      title: "Sitzungen konnten nicht durchsucht werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    sessionResume: {
      title: "Sitzung konnte nicht geöffnet werden",
      description: "Die Sitzung wurde möglicherweise verschoben oder gelöscht",
    },
    sessionHistory: {
      title: "Frühere Nachrichten konnten nicht geladen werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    sessionPrompt: {
      title: "Nachricht konnte nicht gesendet werden",
      description:
        "Prüfen Sie Modelleinstellungen und Authentifizierung und versuchen Sie es erneut",
    },
    sessionAbort: {
      title: "Antwort konnte nicht gestoppt werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    sessionDelete: {
      title: "Unterhaltung konnte nicht gelöscht werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    sessionRename: {
      title: "Unterhaltung konnte nicht umbenannt werden",
      description: "Versuchen Sie es gleich noch einmal",
    },
    projectFiles: {
      title: "Dateien konnten nicht gelesen werden",
      description: "Prüfen Sie, ob der Projektordner zugänglich ist",
    },
  },
  automations: {
    editor: {
      create: "Definition schreiben",
      edit: "Definition bearbeiten",
      newTitle: "Neue Automatisierung",
      editTitle: "„{name}“ bearbeiten",
      description:
        "Schreibe die Definition der Automatisierung als JSON. Speichern hier gilt als deine Freigabe.",
      definition: "Definition",
      definitionHelp:
        "Dasselbe Format, das Pine beim Schreiben von Automatisierungen nutzt. „Prüfen“ zeigt vor dem Speichern, was sie tun wird.",
      invalidJson: "Die Definition muss ein JSON-Objekt sein.",
      check: "Prüfen",
      save: "Speichern",
      saved: "Automatisierung gespeichert",
      dryRun: "Ergebnis des Probelaufs",
    },
    title: "Automationen",
    description:
      "Arbeit, die Pine selbst erledigt, wenn eine Uhrzeit, eine Dateiänderung oder eine Website-Aktualisierung es verlangt. Bitte Pine in einem Gespräch, eine einzurichten.",
    backgroundNotice:
      "Automationen laufen nur, solange Pine geöffnet ist. Aktiviere in den Einstellungen die Ausführung im Hintergrund, damit sie nach dem Schließen des Fensters weiterlaufen.",
    started: "Ausführung gestartet",
    enabled: "Aktiviert",
    runNow: "Jetzt ausführen",
    instructions: "Anweisungen",
    refresh: "Aktualisieren",
    showNothingRuns: "Ausführungen ohne Neues anzeigen",
    markAllRead: "Alle als gelesen markieren",
    unread: "Ungelesen",
    noRuns: "Noch keine Aktivität",
    empty: "Noch keine Automationen",
    emptyHint:
      "Beschreibe in einem Gespräch, was erledigt werden soll, zum Beispiel „fasse werktags um 9 Uhr neue Dateien in Reports zusammen“.",
    next: "nächste {time}",
    deleteTitle: "Diese Automation löschen?",
    deleteDescription:
      "„{name}“ und der Ausführungsverlauf werden gelöscht. Erstellte Dateien bleiben erhalten.",
    tabs: {
      activity: "Aktivität",
      automations: "Automationen",
      secrets: "Geheimnisse",
    },
    status: {
      running: "Läuft",
      findings: "Etwas gefunden",
      nothing: "Nichts Neues",
      failed: "Fehlgeschlagen",
      interrupted: "Unterbrochen",
      skipped: "Übersprungen",
    },
    state: {
      active: "An",
      disabled: "Aus",
      paused: "Pausiert",
    },
    trigger: {
      schedule: "Zeitplan",
      folder: "Ordneränderung",
      system: "Systemereignis",
      script: "Website- oder Feed-Prüfung",
      manual: "Manuell",
      batch: "Mehrere Auslöser",
    },
    pause: {
      failures: "Nach {count} fehlgeschlagenen Ausführungen in Folge pausiert.",
      "script-failures":
        "Pausiert, weil die Prüfung {count}-mal in Folge fehlschlug.",
      permission: "Pausiert: Das Projekt erlaubt sie nicht mehr ({detail}).",
      secret: "Pausiert: Geheimnis {secret} wurde gelöscht.",
    },
    run: {
      noSession:
        "Dieser Lauf hat keine Unterhaltung: Er wurde beendet, bevor der Agent startete.",
    },
    secrets: {
      description:
        "Werte, die Automationen verwenden können, etwa API-Tokens. Sie werden auf diesem Computer verschlüsselt, nur an Automationen weitergegeben, die sie nennen, und in allem, was der Agent liest, ausgeblendet.",
      noValue: "Kein Wert",
      usedBy: "verwendet von {names}",
      setValue: "Wert festlegen",
      name: "Name",
      descriptionLabel: "Beschreibung",
      value: "Wert",
      short:
        "Werte mit weniger als {count} Zeichen lassen sich in Ergebnissen nicht zuverlässig ausblenden.",
      add: "Geheimnis hinzufügen",
      desktopOnly:
        "Geheimnisse lassen sich nur in Pine auf diesem Computer ändern.",
    },
    approval: {
      title: {
        create: "Neue Automation",
        update: "Automation ändern",
        enable: "Automation einschalten",
        delete: "Automation löschen",
      },
      description:
        "Vom Agenten in {project} angefragt. Sie läuft unbeaufsichtigt innerhalb der folgenden Berechtigungen.",
      explanationNote:
        "Zusammenfassung des Freigabemodells. Maßgeblich sind die Details darunter.",
      showScript: "Prüfskript anzeigen",
      hideScript: "Prüfskript ausblenden",
      reject: "Ablehnen",
      approve: {
        create: "Freigeben",
        update: "Änderung freigeben",
        enable: "Einschalten",
        delete: "Löschen",
      },
      viaWeChat: "Aus WeChat angefordert",
      desktopOnly: "Gib dies in Pine auf dem Computer frei, der sie ausführt.",
    },
    warnings: {
      "script-read-and-network":
        "Ihr Prüfskript kann deine Dateien lesen und ins Internet.",
      "secret-network": "Sie sendet ein gespeichertes Geheimnis ins Internet.",
      "folder-overlaps-write":
        "Sie schreibt in den Ordner, den sie beobachtet.",
      "after-external-content":
        "Der Agent hat dies vorgeschlagen, nachdem er Web- oder Tool-Inhalte gelesen hat.",
      "privileged-tools":
        "Sie kann eine Shell außerhalb der Sandbox nutzen (jeder Aufruf wird geprüft).",
      networkExecution: "Ihre Befehle können {hosts} erreichen.",
      mcpOutsideSandbox:
        "Seine MCP-Server ({servers}) laufen außerhalb der Sandbox mit eigenem Zugriff auf Dateien und das Internet; nur die aufgeführten Tools können aufgerufen werden.",
    },
    facts: {
      missing: "fehlt",
      localTime: "Ortszeit",
      schedule: "{rule} ({zone})",
      folder: "{events} in {folder}, passend zu {include}",
      change: {
        added: "Hinzugefügt",
        changed: "Geändert",
        removed: "Entfernt",
      },
      system: {
        resume: "Beim Aufwachen des Computers",
        unlock: "Beim Entsperren des Bildschirms",
        "app-start": "Beim Start von Pine",
        idle: "Nach {minutes} Minuten Inaktivität",
      },
      window: "zwischen {from} und {to}",
      oncePer: {
        day: "einmal täglich",
        week: "einmal pro Woche",
      },
      script: "Prüft alle {every}, kontaktiert {hosts}",
      none: "keine",
      manual: "Nur bei manuellem Start",
      triggers: "Läuft",
      read: "Liest",
      write: "Schreibt",
      network: "Internet",
      tools: "Werkzeuge",
      secrets: "Geheimnisse",
      skills: "Skills",
      outputs: "Ergebnisse in",
      limits: "Grenzen",
      limitValues:
        "höchstens {runs} Ausführungen pro Tag, je {minutes} Minuten",
      changed: "geändert",
      mcp: "MCP",
      model: "Modell",
      thinking: "Denkstufe {level}",
      defaultModel: "Ihr Standardmodell",
    },
  },
} as const;
