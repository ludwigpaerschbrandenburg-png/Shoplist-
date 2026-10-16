/*
 * Gebsoulting – Inhalte, die sich oft ändern: Deals, Team, Branchen.
 * Neue Deals einfach als weiteren Eintrag in die Liste schreiben.
 * Die ersten drei Deals erscheinen zusätzlich auf der Startseite.
 *
 * Felder eines Deals:
 *   art       – Filterkategorie, z. B. "M&A", "Nachfolge", "Finanzierung", "Strategie", "Integration"
 *   partei    – Mandant bzw. Unternehmen (oder anonymisiert, z. B. "Familienunternehmen")
 *   aktion    – was passiert ist, z. B. "wurde verkauft an"
 *   gegenpartei – optional: Käufer, Investor, Partner
 *   rolle     – unsere Rolle, z. B. "Sell-Side-Beratung"
 *   branche, jahr – kurze Angaben für die Fußzeile des Tombstones
 *   platzhalter – true, solange es ein Beispiel-Eintrag ist
 */
window.GEBSOULTING_DATA = {
  deals: [
    {
      art: "M&A",
      partei: "Inhabergeführter Maschinenbauer",
      aktion: "wurde verkauft an",
      gegenpartei: "einen strategischen Investor",
      rolle: "Sell-Side-Beratung",
      branche: "Maschinenbau",
      jahr: "2025",
      platzhalter: true
    },
    {
      art: "Nachfolge",
      partei: "Regionaler Großhändler",
      aktion: "Nachfolge geregelt durch",
      gegenpartei: "Management-Buy-out",
      rolle: "Strukturierung & Finanzierung",
      branche: "Handel",
      jahr: "2025",
      platzhalter: true
    },
    {
      art: "M&A",
      partei: "IT-Dienstleister",
      aktion: "hat übernommen",
      gegenpartei: "einen Wettbewerber",
      rolle: "Buy-Side-Beratung",
      branche: "IT-Services",
      jahr: "2024",
      platzhalter: true
    },
    {
      art: "Finanzierung",
      partei: "Wachstumsunternehmen",
      aktion: "Wachstumsfinanzierung durch",
      gegenpartei: "Beteiligungsgesellschaft",
      rolle: "Investorensuche",
      branche: "Software",
      jahr: "2024",
      platzhalter: true
    },
    {
      art: "Integration",
      partei: "Unternehmensgruppe",
      aktion: "Integration von",
      gegenpartei: "zwei Zukäufen",
      rolle: "Post-Merger-Integration",
      branche: "Dienstleistung",
      jahr: "2024",
      platzhalter: true
    },
    {
      art: "Strategie",
      partei: "Familienunternehmen",
      aktion: "Neuausrichtung mit",
      gegenpartei: "Wachstumsstrategie 2030",
      rolle: "Strategieentwicklung",
      branche: "Konsumgüter",
      jahr: "2023",
      platzhalter: true
    }
  ],

  team: [
    {
      name: "[Name]",
      rolle: "Gründer:in & Geschäftsführung",
      text: "Schwerpunkt Transaktionen und Strategie. Kurzbiografie folgt: bisherige Stationen, Branchen, Anzahl begleiteter Deals.",
      platzhalter: true
    },
    {
      name: "[Name]",
      rolle: "Partner:in Transaktionen",
      text: "Schwerpunkt M&A-Prozesse, Bewertung und Verhandlung. Kurzbiografie folgt.",
      platzhalter: true
    },
    {
      name: "[Name]",
      rolle: "Senior Consultant Operations",
      text: "Schwerpunkt Integration, Prozesse und Umsetzung. Kurzbiografie folgt.",
      platzhalter: true
    }
  ],

  branchen: [
    "Maschinen- und Anlagenbau",
    "Handel und Großhandel",
    "IT und Software",
    "Unternehmensnahe Dienstleistungen",
    "Konsumgüter",
    "Bau und Handwerk"
  ]
};
