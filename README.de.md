# Zwei CLI

<p align="right"><a href="./README.md">English</a> | <a href="./README.zh.md">简体中文</a> | <a href="./README.ja.md">日本語</a> | <b>Deutsch</b></p>

> **Experimentelles** Dual-Agent-Coding-Tool. **PhD schreibt, Supervisor prüft.**
>
> Eine andere Sichtweise darauf, wie Coding-Agenten zusammengesetzt werden können: zwei isolierte Köpfe, eine Codebasis, asymmetrisches Gedächtnis.
>
> Fork von [opencode](https://github.com/sst/opencode).
>
> _„Zwei" — deutsch für die Zahl 2._

<p align="center"><img src="./assets/welcome.png" alt="Zwei TUI Willkommensbildschirm" width="720"></p>

---

## Warum

Die meisten Coding-Agenten stopfen alles in einen einzigen Kontext: Lesen, Schreiben, Tests laufen lassen, benoten, wiederholen. Je länger der Durchlauf, desto dünner wird die Aufmerksamkeit, desto mehr übertönt die Testausgabe die eigentliche Absicht — und am Ende benotet der Agent seine eigene Hausaufgabe.

Zwei übernimmt ein Muster aus der Wissenschaft: **PhD schreibt, Supervisor benotet.** Zwei isolierte Sessions, zwei unabhängige Skill-Sets, einseitiger Informationsfluss an der Grenze. Der Schreibende sieht nie die Argumentation des Prüfenden — er kann also nicht dagegen optimieren.

## Die zentrale Wette

Die Prämisse von Zwei ist einfach: einen Coding-Agenten in **zwei isolierte Rollen** aufteilen — PhD schreibt, Supervisor prüft — und Informationen fließen **nur in eine Richtung**. Der Schreibende sieht niemals die Argumentation des Prüfenden.

Das zielt auf einen realen Fehlermodus: **die Selbstbewertung eines einzelnen Agenten verschlechtert sich im Laufe langer Konversationen** (manchmal „Goodharting" genannt — man benotet seine eigene Hausaufgabe und bekommt dabei immer eine Eins).

Ein konkretes Beispiel. Man bittet einen Agenten, eine Sortierfunktion zu schreiben und sie selbst zu testen:

- **Single-Agent-Modus:** Er schreibt einen fehlerhaften Test, „besteht" seinen eigenen fehlerhaften Test und erklärt den Sieg.
- **Zweis Dual-Agent-Modus:** Der PhD schreibt die Funktion, **kann aber die Tests nicht sehen und hat kein `bash`**. Der Supervisor prüft den Code unabhängig und führt die Tests aus. Keiner der beiden Kontexte kontaminiert den anderen.

Das ist eine **architektonische Wette**: _Rollenisolation + Informationsasymmetrie > ein einziger Kontext, der alles macht_. Die Hypothese ist es wert, erkundet zu werden — besonders bei komplexen, mehrstufigen Coding-Aufgaben. Heute versteht man Zwei aber am besten als **ein vielversprechendes Experiment, nicht als validiertes Werkzeug**. Wer sich für Agenten-Architektur interessiert: einen Blick wert. Wer einfach einen täglichen Coding-Assistenten sucht: später wiederkommen.

## Kernideen

- **Geteilte Aufmerksamkeit** — zwei physisch isolierte Sessions. Der PhD fokussiert sich auf das Schreiben, der Supervisor auf die Prüfung. Keine Rolle verbrennt Aufmerksamkeit für die Aufgabe der anderen.
- **Unabhängige Skills** — jede Rolle lädt ihr eigenes Skill-Set. Standardmäßig wird nichts geteilt — der PhD wird nicht von Review-Werkzeugen abgelenkt, der Supervisor nicht versucht, selbst einzugreifen.
- **Asymmetrisches Gedächtnis** — der PhD sieht nie die Argumentation des Supervisors; nur ein strukturiertes Urteil überquert die Grenze. Der Supervisor sieht den Code des PhD und die Testausgabe. Das Gedächtnis fließt per Design in nur eine Richtung.
- **Schreiben- / Test-Trennung** — der PhD hat kein `bash` und keinen Lesezugriff auf Tests. Selbstverifikation ist physisch unmöglich, und der Kontext des Schreibenden bleibt sauber — keine Tool-Spuren, keine Testausgaben, keine Datei-Dumps, die ihn verschmutzen.

Der kombinierte Effekt: Der Schreibende kann den Prüfenden nicht per Goodharting austricksen, und keiner der beiden Kontexte wird durch die Artefakte des anderen kontaminiert.

## Actor-Critic — ein Substrat für Selbstverbesserung

Strukturell ist die PhD / Supervisor-Aufteilung ein klassisches **Actor-Critic**-Schema: Der PhD ist der Actor, der Supervisor der Critic. Diese Zuordnung ist nicht kosmetisch — sie öffnet eine Schleife, die ein Single-Agent-Aufbau nicht schließen kann:

- **Das Urteil des Critics ist ein natürliches Trainingssignal.** Der Supervisor gibt ohnehin strukturierte Pass/Fail-Urteile mit Begründung aus. Persistiert man sie, erhält man einen gelabelten Datensatz „wo und warum der Agent scheitert" — ohne einen Schritt menschlicher Annotation.
- **Informationsasymmetrie hält das Signal ehrlich.** Jedes Belohnungssignal, das ein einzelner Agent durch Selbstbenotung erzeugt, wird Goodhart-verzerrt. Die Isolation bei Zwei sorgt dafür, dass das Urteil des Critics nicht im Kontext des Actors lebt — das Signal ist sauberer und als Trainingsziel besser geeignet.
- **Die Schleife kann sich ohne Menschen schließen.** PhD schreibt → Supervisor benotet → Urteil gespeichert → periodisches Fine-Tuning / Prompt-Evolution → der nächste PhD ist einen Tick schärfer. Actor → Umgebung → Critic → Actor, Maschine zu Maschine.

Nichts davon ist bisher verdrahtet — pre-1.0, der Fokus liegt weiterhin auf Inferenz. Aber die Grenzen sind bereits dafür geformt: strukturierte Urteile, persistierte Sessions, asymmetrisches Gedächtnis. Die langfristige Wette: ein Coding-Agent, der **mit der Nutzung besser wird**, statt auf dem Stand einer Modellversion einzufrieren.

## Installation

### Aus dem Quellcode

```bash
git clone https://github.com/ZweiAI/ZweiCli
cd ZweiCli
bun install
bun run --cwd packages/zwei dev --help
```

### Über npm

```bash
npm install -g @zweicli/cli
zwei --help
```

Auto-Update ist standardmäßig aktiv und folgt `@zweicli/cli@latest` auf npm. Manuelles Update: `zwei upgrade`, oder `npm install -g @zweicli/cli@latest`.

Für alles außerhalb der Dual-Schleife (Auth, Modelle, Provider, Sessions, Web-UI) gelten weiterhin die Upstream-Konventionen von opencode. Siehe [opencode.ai](https://opencode.ai).

## Verwendung

TUI starten:

```bash
zwei
```

### Slash-Befehle

Sobald man im TUI ist, `/` im Prompt eingeben. Die für den Dual-Agent-Workflow relevanten Befehle:

| Befehl | Funktion |
|---|---|
| `/agents` (oder `/agent`) | Modus × Rolle wählen. Siehe Modus-Tabelle unten |
| `/model` | Modell für **PhD und Supervisor** gleichzeitig ändern |
| `/model1` | Modell nur für **PhD** (den Schreibenden) ändern |
| `/model2` | Modell nur für **Supervisor** (den Prüfenden) ändern |
| `/clear` | Konversation in allen drei Sessions löschen (du + PhD + Supervisor) |
| `/clear1` | Nur die Session des PhD löschen |
| `/clear2` | Nur die Session des Supervisors löschen |

### `/agents` — einen Modus wählen

Der Agents-Dialog zeigt sechs Optionen — das Produkt aus drei **Modi** und zwei **Rollen**:

| Modus | Was er tut | Wann man ihn nimmt |
|---|---|---|
| **`dual`** | Jede Runde: PhD schreibt, dann prüft der Supervisor. Der Supervisor läuft **immer** | Lange Aufgaben, strenge Review, Anti-Goodhart-Eval-Setups |
| **`auto`** | PhD schreibt zuerst. Besteht ein Test-Gate, wird der Supervisor übersprungen; sonst aufgerufen | Standard — spart Tokens, wenn der Schreibende in der ersten Runde trifft |
| **`single`** | Nur PhD, kein Supervisor. Entspricht dem Single-Agent-Flow des Upstream-opencode | Aufgaben, die ein starkes Modell in einem Durchgang löst — kein Grund, für Review zu zahlen |

Das **Rollen**-Suffix (`fast` vs. `plan`) wählt die Agent-Variante:

- **`fast`** — Ausführungsmodus; der Agent bearbeitet und führt tatsächlich aus
- **`plan`** — Planungsmodus; schreibgeschützt, erstellt ein Plandokument, bevor in den Fast-Modus gewechselt wird

Also bedeutet `dual fast` „PhD + Supervisor, beide im Ausführungsmodus", `auto plan` heißt „PhD plant zuerst, Supervisor prüft den Plan auf Anforderung", und so weiter.

### Unterschiedliche Modelle für PhD und Supervisor

Der eigentliche Sinn der asymmetrischen Aufteilung ist: der Schreibende kann günstig sein, der Prüfende stark (oder umgekehrt):

```
/model1   # schnelles / günstiges Modell für den PhD wählen (z. B. Haiku 4.5)
/model2   # starkes / pingeliges Modell für den Supervisor wählen (z. B. Opus 4.6)
```

Das Umschalten funktioniert auch mitten im Durchlauf — die Änderung greift in der nächsten Runde, nicht in der aktuellen.

## Status

Pre-1.0, experimentell. Architektur und Terminologie können sich noch ändern. Issues und PRs sind willkommen — besonders Workload-Berichte, die zeigen, wo Dual gegenüber Single-Agent-Baselines gewinnt oder verliert.

## Lizenz

MIT. Siehe [LICENSE](./LICENSE) — das ursprüngliche opencode-Copyright bleibt erhalten und steht neben dem von ZweiAI.
