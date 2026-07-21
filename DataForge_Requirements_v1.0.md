**DataForge – Comprehensive Grok Build Prompt**
---

Build a complete, production-quality, 100% local desktop application called **DataForge**.

### Goal
DataForge is a powerful offline test-data generator for ETL pipelines. Users visually design hierarchical schemas using nested key-value rows, generate realistic data (drawing from a growing local history of user-entered values), and export to any common pipeline ingest format. Everything the user does is persisted locally so the tool becomes smarter over time with autocomplete and suggestions.

### Absolute Requirements
- Runs 100% offline / locally. No cloud services, no external API calls after initial install.
- Uses SQLite as the primary database for all persistent state (schemas, templates, value history, interaction log, settings).
- Also maintains a single cache file named exactly `DataForge_user_cache` (JSON or SQLite snapshot) that is updated on every meaningful action.
- No artificial limits on number of rows, nesting depth, or number of templates.
- Modern, clean, responsive UI (dark/light mode support preferred).
- Cross-platform (Windows / macOS / Linux) if possible; prioritize Electron, Tauri, or equivalent local packaging.

### Core Features (must all be implemented)

1. **Visual Schema Builder**
   - Users create schemas by adding “Rows”.
   - Each Row is a key–value pair.
   - Support unlimited nesting (objects and arrays) so hierarchical data (JSON/XML/YAML) can be modeled.
   - Every Row belongs to a Category (auto-derived from the key name + user can override). Categories are used for type inference and value history.
   - Optional “Primary / Unique Identifier” flag on any field.
   - Relationship selector on any nested structure: One-to-One, One-to-Many, Many-to-One, Many-to-Many. These relationships influence how data is generated and how nested structures are expanded.
   - Drag-and-drop reordering and easy nesting/un-nesting.
   - Live preview pane showing the current schema in the selected target format.

2. **Value History & Smart Generation Engine**
   - Every value a user types into any field is stored against its Category/Key in SQLite.
   - Maintain a growing pool of unique values per Category. The system must be able to generate at least 100 unique random values drawn from (or extrapolated from) this history.
   - When generating data the engine should:
     - Prefer sampling from the user’s historical values for that Category/Key.
     - Fall back to generating new unique values that match the observed patterns (length, character class, numeric range, date format, etc.).
     - Respect the Primary/Unique flag (guarantee uniqueness within a generation run).
     - Honor the relationship cardinalities when expanding nested structures.
   - Generation quantity is user-controlled (number of root records).

3. **Export Formats**
   - Primary targets: JSON, XML, CSV, TXT, YAML/YML.
   - Also support conversion of an existing schema + data into any of the other formats.
   - CSV specifics:
     - First row = header (keys).
     - Subsequent rows = data.
     - Nested objects/arrays are flattened with clear naming (or user-configurable delimiter) or serialized as JSON strings inside cells (user choice).
   - Option to package the generated file(s) into a `.tar`, `.TAR`, `.zip`, or `.ZIP` archive (user chooses exact casing). Multiple files can be included in one archive.

4. **Templates**
   - Any schema (with or without sample data) can be saved as a named Template.
   - Templates are stored in SQLite and can be loaded, edited, duplicated, or deleted.
   - Quick-load recent templates on the home screen.

5. **Intelligence Layer (Autocomplete + Suggestions)**
   - Every keystroke, field addition, value entry, and generation action is logged.
   - As the user types keys or values, show intelligent autocomplete and suggestions drawn from:
     - Historical keys/values for the current Category.
     - Previously used schemas and templates.
     - Common patterns observed across the entire local database.
   - Suggestions improve the longer the user works with the tool.

6. **Persistence & Cache**
   - Full SQLite database (recommend schema with tables for: schemas, templates, value_history, categories, interactions, settings).
   - On every significant action also update/overwrite the file `DataForge_user_cache` so the entire state can be easily backed up or moved.
   - Export/import of the entire SQLite + cache for backup/transfer between machines.

### Recommended Tech Stack (feel free to improve if you have a better local-first approach)
- Frontend: React + TypeScript + Tailwind (or equivalent modern stack) with excellent nested form / tree UI components.
- Desktop shell: Electron or Tauri.
- Database: better-sqlite3 (or sql.js if pure browser) + proper migrations.
- Data generation: combination of user history + deterministic random + simple pattern inference (no external Faker dependency required, but you may use a pure local implementation).
- File handling: native Node/Electron APIs for writing JSON/XML/CSV/YAML and creating tar/zip archives with correct casing.
- State management that keeps the UI responsive even with large nested schemas and thousands of historical values.

### UI / UX Expectations
- Clean left sidebar: Templates, Recent Schemas, Value History explorer, Settings.
- Main canvas: Schema builder (tree + property panel).
- Right panel or bottom drawer: Live preview + Generation controls + Export options.
- Clear visual distinction between primary keys, relationship edges, and nested arrays/objects.
- Keyboard-friendly (add row, nest, generate, export via shortcuts).
- Progress feedback when generating large datasets or packaging archives.

### Non-Goals
- No authentication / multi-user.
- No cloud sync.
- No external LLM or internet calls at runtime.

### Deliverable
Produce a complete, runnable local application with:
- Clear README covering installation, first-run, and how the SQLite + DataForge_user_cache work.
- Sensible default sample templates (e.g., simple flat CSV, nested JSON order + items, XML invoice style).
- Source code that is well-structured and documented so the user can continue extending it.

Start by designing the SQLite schema and the core data models for Schema / Row / Category / ValueHistory / Template / Relationship, then implement the visual builder and generation engine.

Build DataForge so that after a few days of use it feels like a personal, intelligent test-data companion that already “knows” the kinds of files and field names the user typically needs for their ETL pipelines.

---