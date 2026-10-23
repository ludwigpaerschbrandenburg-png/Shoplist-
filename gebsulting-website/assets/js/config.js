/*
 * Gebsulting – zentrale Unternehmensdaten.
 * Alles, was in eckigen Klammern steht, vor dem Livegang ersetzen.
 * Die Werte erscheinen automatisch überall auf der Seite (Kontakt, Footer, Impressum, Datenschutz).
 */
window.GEBSULTING_CONFIG = {
  legalName: "Gebsulting [Rechtsform, z. B. GmbH]",
  representative: "Paul Gebhardt (CEO)",
  email: "Ludwig_p@online.de",
  phone: "+49 [Vorwahl] [Nummer]",
  address: ["[Straße Hausnummer]", "[PLZ Ort]", "Deutschland"],
  hours: "Mo–Fr, 9–18 Uhr",
  register: "[Registergericht], [HRB-Nummer]",
  vatId: "[DE000000000]",

  /*
   * Kontaktformular:
   * - Leer lassen ("") → nach dem Ausfüllen erscheinen Knöpfe (Gmail, Outlook, E-Mail-Programm),
 *   die die fertige Nachricht an die Adresse oben öffnen. Funktioniert überall, auch in der Vorschau.
   * - Endpoint eines Formular-Dienstes eintragen (z. B. Formspree: "https://formspree.io/f/xxxxxxx")
   *   → Anfragen werden direkt verschickt, ohne E-Mail-Programm.
   */
  formEndpoint: "",

  // Optional: Handynummer für "Per WhatsApp senden", z. B. "+49 170 1234567". Leer = kein WhatsApp-Knopf.
  whatsapp: "",

  // true zeigt den Hinweis "Beispiel" bei Platzhalter-Deals. Auf false setzen, sobald echte Deals drin sind.
  showPlaceholderNotice: true
};
