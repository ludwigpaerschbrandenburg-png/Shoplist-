using MelonLoader;

// MelonInfo: Name, Version und Autor, wie sie im MelonLoader-Log erscheinen.
[assembly: MelonInfo(typeof(TurboMod.TurboModMain), "TurboMod", "0.1.0", "Ludwig")]

// MelonGame(null, null) = universell, laedt in jedem Spiel.
// Sobald Company/Product aus MelonLoader\Latest.log bekannt sind, hier eintragen,
// z.B. [assembly: MelonGame("Studio", "Nomad Drive Demo")] - dann warnt MelonLoader,
// falls das Mod versehentlich in einem anderen Spiel landet.
[assembly: MelonGame(null, null)]

namespace TurboMod
{
    public class TurboModMain : MelonMod
    {
        /// <summary>
        /// Wird aufgerufen, sobald MelonLoader das Mod initialisiert hat.
        /// Genau eine Logzeile - mehr soll dieser Test nicht tun.
        /// </summary>
        public override void OnInitializeMelon()
        {
            LoggerInstance.Msg("TurboMod geladen");
        }

        /// <summary>
        /// Zusatznachweis, dass das Mod auch nach dem Szenenwechsel noch lebt.
        /// Hilfreich, um spaeter den richtigen Zeitpunkt zum Patchen zu finden.
        /// </summary>
        public override void OnSceneWasInitialized(int buildIndex, string sceneName)
        {
            LoggerInstance.Msg("Szene initialisiert: " + sceneName + " (Index " + buildIndex + ")");
        }
    }
}
