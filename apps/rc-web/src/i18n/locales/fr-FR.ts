import type zhCN from "./zh-CN";

export default {
  scanCode: "Scanner le code d’association",
  scanDescription:
    "Dirigez la caméra vers le code dans Réglages → Contrôle à distance de Pine. Si Pine Remote est sur votre écran d’accueil, scannez ici pour enregistrer l’ordinateur dans cette app.",
  cameraFailed:
    "Impossible d’accéder à la caméra. Autorisez-la dans les réglages du navigateur ou du système, puis réessayez.",

  title: "Pine à distance",
  unsupported:
    "Ce navigateur ne peut pas utiliser le contrôle à distance. Utilisez une version récente de Safari ou de Chrome.",
  starting: "Démarrage…",
  pairing: "Connexion à votre ordinateur…",
  confirmOnComputer: "Cliquez sur Autoriser sur votre ordinateur.",
  connecting: "Connexion à {name}…",
  handshaking: "Établissement d'une connexion chiffrée…",
  computer: "Ordinateur",
  device: "Appareil",
  otherComputers: "Choisir un autre ordinateur",
  retry: "Réessayer",
  back: "Retour",
  reconnect: "Se reconnecter",
  disconnected: "La connexion à {name} a été perdue.",
  forget: "Retirer",
  forgetTitle: "Retirer « {name} » ?",
  forgetDescription:
    "Cet appareil ne pourra plus s'y connecter tant que vous ne l'aurez pas de nouveau associé.",
  cancel: "Annuler",
  emptyList:
    "Aucun ordinateur n'est encore associé. Sur votre ordinateur, ouvrez Réglages de Pine → Contrôle à distance, cliquez sur Associer un appareil, puis scannez le code ou ouvrez le lien d'association.",
  lastConnected: "Dernière connexion {date}",
  expired: "Ce code a expiré. Créez-en un nouveau sur votre ordinateur.",
  invalid: "Ce n'est pas un lien d'association Pine.",
  network:
    "Impossible de joindre le service de signalisation. Vérifiez votre réseau et réessayez.",
  offline:
    "{name} ne répond pas. Vérifiez que Pine y est en cours d'exécution et que le contrôle à distance via Aldine est activé.",
  declined: "L'association a été refusée sur l'ordinateur.",
  unavailable:
    "L'ordinateur ne peut pas accepter d'appareils pour le moment. Vérifiez que l'accès par navigateur est activé dans Pine.",
  failed: "Impossible de se connecter à l'ordinateur. Réessayez plus tard.",
} satisfies typeof zhCN;
