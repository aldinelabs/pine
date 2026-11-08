import type zhCN from "./zh-CN";

export default {
  scanCode: "Kopplungscode scannen",
  scanDescription:
    "Richte die Kamera auf den Code in Pine Einstellungen → Fernsteuerung. Wenn Pine Remote zum Home-Bildschirm hinzugefügt wurde, scanne hier, um den Computer in dieser App zu speichern.",
  cameraFailed:
    "Kein Kamerazugriff. Erlaube den Zugriff in den Browser- oder Systemeinstellungen und versuche es erneut.",

  title: "Pine Fernzugriff",
  unsupported:
    "Dieser Browser kann die Fernsteuerung nicht nutzen. Verwenden Sie ein aktuelles Safari oder Chrome.",
  starting: "Wird gestartet…",
  pairing: "Verbindung zu Ihrem Computer wird hergestellt…",
  confirmOnComputer: "Klicken Sie auf Ihrem Computer auf „Erlauben“.",
  connecting: "Verbindung zu {name} wird hergestellt…",
  handshaking: "Verschlüsselte Verbindung wird aufgebaut…",
  computer: "Computer",
  device: "Gerät",
  otherComputers: "Anderen Computer wählen",
  retry: "Erneut versuchen",
  back: "Zurück",
  reconnect: "Erneut verbinden",
  disconnected: "Die Verbindung zu {name} wurde unterbrochen.",
  forget: "Entfernen",
  forgetTitle: "„{name}“ entfernen?",
  forgetDescription:
    "Dieses Gerät kann ihn erst wieder erreichen, wenn Sie es erneut koppeln.",
  cancel: "Abbrechen",
  emptyList:
    "Noch keine Computer gekoppelt. Öffnen Sie auf Ihrem Computer die Pine-Einstellungen → Fernsteuerung, klicken Sie auf „Gerät koppeln“ und scannen Sie den Code oder öffnen Sie den Kopplungslink.",
  lastConnected: "Zuletzt verbunden {date}",
  expired:
    "Dieser Code ist abgelaufen. Erstellen Sie auf Ihrem Computer einen neuen.",
  invalid: "Das ist kein Pine-Kopplungslink.",
  network:
    "Der Signalisierungsdienst ist nicht erreichbar. Prüfen Sie Ihr Netzwerk und versuchen Sie es erneut.",
  offline:
    "{name} antwortet nicht. Stellen Sie sicher, dass Pine dort läuft und die Fernsteuerung über Aldine aktiviert ist.",
  declined: "Die Kopplung wurde auf dem Computer abgelehnt.",
  unavailable:
    "Der Computer kann derzeit keine Geräte annehmen. Stellen Sie sicher, dass der Browserzugriff in Pine aktiviert ist.",
  failed:
    "Verbindung zum Computer fehlgeschlagen. Versuchen Sie es später erneut.",
} satisfies typeof zhCN;
