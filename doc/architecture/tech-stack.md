# Tech Stack

> **Source paths:** `composer.json`, `package.json`, `gulpfile.js`,
> `openemr-reference/CLAUDE.md`, `version.php`
> **Documented version:** OpenEMR 8.0.1-dev (`v_database = 535`)

OpenEMR is a 20-year-old, two-tier PHP application that has accreted a deep
modern stack on top of its procedural foundation. This file enumerates the exact
versions, the purpose of each component, and the build pipeline.

---

## 1. Runtime

### 1.1 PHP

| Item | Value | Source |
|---|---|---|
| Minimum version | **PHP 8.2+** (strictly enforced) | `composer.json` `require.php` |
| Engine constant | `E_DEPRECATED`, `E_USER_DEPRECATED` silenced in some paths | `composer.json` `config.platform` |
| Memory limit for analysis | 4 GB | `phpcs.xml.dist`, `composer.json` `scripts.*` |

### 1.2 Required PHP extensions (`composer.json`)

```
ext-bcmath       ext-ctype        ext-curl         ext-dom
ext-fileinfo     ext-filter       ext-gd           ext-iconv
ext-imagick      ext-intl         ext-json         ext-ldap
ext-libxml       ext-mbstring     ext-mysqli       ext-openssl
ext-pdo          ext-pdo_mysql    ext-phar         ext-session
ext-simplexml    ext-soap         ext-sockets      ext-sodium
ext-tokenizer    ext-xml          ext-xmlreader    ext-xmlwriter
ext-xsl          ext-zip          ext-zlib         ext-calendar
```

Every extension is pinned in `composer.json` `config.platform` (e.g.
`"ext-bcmath": "8.2"`) to make local installs reproducible on hosts that
do not have them all loaded by default.

### 1.3 Node

- **Node ≥ 22.0.0** (`package.json` `engines.node`)
- **NPM + napa** — napa is used to fetch non-npm packages (jQuery UI bundles,
  react-15 zip, lforms, bootstrap-rtl, jquery-creditcardvalidator, etc.) from
  GitHub tarballs. See `package.json` `napa`.

---

## 2. Composer — Server-side Dependencies

> Source: `composer.json` (298 lines)

### 2.1 Key backend libraries

| Library | Version | Purpose |
|---|---|---|
| `laminas/laminas-mvc` | `^3.8.0` | Legacy Laminas MVC framework (used by `interface/modules/zend_modules/`) |
| `laminas/laminas-mvc-i18n` | `^1.9.0` | Laminas i18n integration |
| `laminas/laminas-servicemanager` | `^3.24.0` | ServiceManager (DI container) |
| `laminas/laminas-form` | `^3.24.0` | Form abstraction |
| `laminas/laminas-inputfilter` | `^2.34.0` | Input validation |
| `laminas/laminas-eventmanager` | `^3.15.0` | Event manager (legacy) |
| `laminas/laminas-soap` | `^2.14.0` | SOAP server/client (lab integrations) |
| `laminas/laminas-json-server` | `^3.9.0` | Legacy JSON-RPC surface |
| `laminas/laminas-xmlrpc` | `^2.22.0` | XML-RPC (rare integrations) |
| `symfony/config` | `~6.4.26` | YAML/PHP config loader |
| `symfony/console` | `~6.4.27` | CLI command framework |
| `symfony/dependency-injection` | `~6.4.26` | DI container (used by `src/Core/Kernel.php`) |
| `symfony/event-dispatcher` | `~6.4.25` | **Primary event bus for OpenEMR** |
| `symfony/event-dispatcher-contracts` | `^3.6` | Event contracts |
| `symfony/http-foundation` | `~6.4.26` | Request/Response/Session/Cookie abstractions |
| `symfony/http-kernel` | `~6.4.27` | HttpKernelInterface — used by `src/Core/OEHttpKernel.php` |
| `symfony/http-client` | `~6.4.26` | HTTP client (used by `OpenEMR\Common\Http\oeHttp`) |
| `symfony/filesystem`, `symfony/finder`, `symfony/yaml` | `~6.4.2x` | Filesystem utilities |
| `symfony/psr-http-message-bridge` | `~6.4.24` | Symfony ⇄ PSR-7 bridge |
| `doctrine/dbal` | `^4.4` | **Modern DB layer (under `src/BC/`)** |
| `doctrine/migrations` | `^3.9` | Doctrine Migrations library (the project uses its own meta-language; see `database/migrations.md`) |
| `league/oauth2-server` | `^8.4` | OAuth2 server (ResourceServer + AuthorizationServer) |
| `steverhoades/oauth2-openid-connect-server` | `^3.0.1` | OIDC extension on top of league/oauth2-server |
| `lcobucci/jwt` | `^4.3.0` | JWT parsing/validation (client assertions, SMART) |
| `lcobucci/clock` | `^2.3` | PSR-20 clock (testing) |
| `monolog/monolog` | `^3.9.0` | PSR-3 logger (used everywhere via `ServiceContainer::getLogger()`) |
| `ramsey/uuid` | `^4.9.2` | UUID generation (COMB UUIDs in `UuidRegistry`) |
| `guzzlehttp/guzzle` | `^7.10.0` | HTTP client (FHIR, e-prescribe, lab connectors) |
| `kamermans/guzzle-oauth2-subscriber` | `^1.1.1` | OAuth2 subscriber for Guzzle |
| `nyholm/psr7` + `nyholm/psr7-server` | `^1.8.2` / `^1.1.0` | PSR-7 server request factory |
| `adodb/adodb-php` | `^5.22.11` | **Legacy DB surface (ADODB_mysqli_log)** |
| `twig/twig` | `^3.22.2` | **Modern templating engine** |
| `smarty/smarty` | `^4.5.6` | **Legacy templating engine** (still used by `controllers/C_*`) |
| `openemr/mustache` | `^2.15.2` | Mustache (CCDA rendering) |
| `dompdf/dompdf` | `^3.1.4` | PDF generation (statements, reports) |
| `mpdf/mpdf` | `^8.2.7` | PDF generation (HCFA claims, eRx print) |
| `knplabs/knp-snappy` | `^1.5.1` | wkhtmltopdf wrapper |
| `phpoffice/phpspreadsheet` | `^5.3.0` | Excel/CSV import/export (clinical forms, batch communication) |
| `league/csv` | `^9.28.0` | CSV parsing |
| `ezyang/htmlpurifier` | `^4.19.0` | XSS sanitization |
| `html2text/html2text` | `^4.3.2` | HTML → text conversion |
| `bacon/bacon-qr-code` | `^3.0.3` | QR code (MFA TOTP enrollment) |
| `giggsey/libphonenumber-for-php` | `^9.0` | Phone number validation/format |
| `twilio/sdk` | `^8.10.0` | SMS/Voice (oe-module-comlink-telehealth) |
| `ringcentral/ringcentral-php` | `^3.0.4` | RingCentral SMS (oe-module-faxsms) |
| `stripe/stripe-php` | `^16.6.0` | Stripe payment processing |
| `academe/omnipay-authorizenetapi` | `^3.1.2` | Authorize.Net payment |
| `omnipay/stripe` | `^3.2.0` | Stripe via Omnipay |
| `league/omnipay` | `^3.2.1` | Omnipay framework |
| `moneyphp/money` | `^4.8` | Money value object (multi-currency) |
| `yubico/u2flib-server` | `^1.0.2` | U2F MFA server-side challenge/response |
| `robthree/twofactorauth` | `^3.0.2` | 2FA provider catalogue |
| `phpseclib/phpseclib` | `^3.0.48` | SSH/SFTP (X12 clearinghouse, billing SFTP) |
| `paragonie/constant_time_encoding` | `^3.1.3` | Constant-time encoding (timing-attack prevention) |
| `aranyasen/hl7` | `^3.2.2` | HL7 v2 message parsing |
| `phpmailer/phpmailer` | `^6.12.0` | SMTP mail |
| `predis/predis` | `^3.3.0` | Redis client (optional Predis Sentinel session store) |
| `digitickets/lalit` | `^3.4.0` | Custom(?) library |
| `zircote/swagger-php` | `^6.0` | OpenAPI 3 annotation scanner |
| `google/apiclient` | `^2.18.4` | Google APIs (Google Sign-In) |
| `firehed/container` | `^1.0` | PSR-11 container |
| `particle/validator` | `^2.3.6` | Request validation (`OpenEMR\Validators\ProcessingResult`) |
| `pear/archive_tar` | `^1.6.0` | TAR archive handling (backup/restore) |
| `vlucas/phpdotenv` | `^5.6.3` | .env loader (Docker images) |
| `openemr/wkhtmltopdf-openemr` | (custom repo) | Bundled wkhtmltopdf binary |
| `openemr/oe-module-cqm` | (custom repo) | CQM rule data |

### 2.2 Autoload

```json
"autoload": {
    "psr-4": { "OpenEMR\\": "src" },
    "classmap": [ "library/classes" ],
    "files": [
        "library/global_functions.inc.php",
        "library/htmlspecialchars.inc.php",
        "library/formdata.inc.php",
        "library/sanitize.inc.php",
        "library/formatting.inc.php",
        "library/date_functions.php",
        "library/validation/validate_core.php",
        "library/translation.inc.php"
    ]
}
```

- `classmap` is required because `library/classes/` does not follow PSR-4.
- The `files` block loads global helper functions (`attr`, `xlt`, `xlj`,
  `text()`, etc.) on every request — they cannot be namespaced.
- Three legacy directories are excluded from the classmap (compatibility shims
  that would otherwise collide with PSR-4 classes).

### 2.3 Composer scripts

```bash
composer checks                    # composer validate + normalize dry-run
composer code-quality              # runs codespell, conventional-commits, php-syntax-check,
                                   # phpcbf, phpcs, phpstan, rector-check, require-checker
composer phpstan                   # PHPStan level 10 (with custom rules)
composer phpstan-baseline          # regenerate baseline
composer phpcs                     # phpcs
composer phpcbf                    # phpcbf (auto-fix)
composer rector-check              # Rector dry-run
composer rector-fix                # Rector apply
composer require-checker           # composer-require-checker
composer phpunit-isolated          # PHPUnit isolated (no DB/Docker)
composer update-twig-fixtures      # UPDATE_FIXTURES=1 phpunit ... --filter TwigTemplateRenderTest
```

---

## 3. NPM / Frontend Dependencies

> Source: `package.json`

### 3.1 Runtime libraries (production)

| Library | Version | Where it shows up |
|---|---|---|
| `angular` + `angular-sanitize` + `angular-summernote` | `1.8.3` / `0.8.1` | Legacy AngularJS 1.x — secure messaging in patient portal |
| `jquery` | `3.7.1` | Every legacy page |
| `jquery-ui` | `1.12.1` (via napa) | Dialog, drag-drop, autocomplete |
| `jquery-datetimepicker` | `2.5.21` | Date/time inputs |
| `jquery-validation` | `1.22.1` | Form validation |
| `knockout` | `3.5.2` | **Main app framework — frameset tabs, patient chart** |
| `backbone` | `1.6.1` | (Mostly unused) |
| `bootstrap` | `4.6.2` | UI framework |
| `bootswatch` | `4.6.2` | Bootstrap themes |
| `select2` | `4.0.13` | Enhanced select boxes |
| `summernote` | `0.9.1` | WYSIWYG editor |
| `ckeditor5` | `47.6.1` | Modern rich-text editor |
| `datatables.net` + plugins | `1.13.11` / `2.4.3` / `1.7.2` | Tabular data |
| `chart.js` + `chartjs-adapter-date-fns` | `4.5.1` / `3.0.0` | Charts (dashboard widgets) |
| `flot` | `4.2.6` | Legacy time-series chart (vitals) |
| `dwv` | `0.27.1` | DICOM web viewer |
| `konva` | `9.3.22` | Eye-mag drawing canvas |
| `magic-wand-js` | `1.0.0` | Image segmentation (eye-mag) |
| `dropzone` | `5.9.3` | File upload |
| `dompurify` | `3.3.3` | XSS sanitization |
| `jspdf` | `4.2.1` | PDF generation in browser |
| `jszip` | `3.10.1` | ZIP creation (CCDA export) |
| `moment` | `2.30.1` | Date utilities |
| `numeral` | `2.0.6` | Number formatting |
| `i18next` + `i18next-browser-languagedetector` + `i18next-xhr-backend` | `24.2.3` / `8.2.1` / `3.2.2` | i18n runtime |
| `interactjs` | `1.10.27` | Drag/resize (eye-mag) |
| `hotkeys-js` | `3.13.15` | Keyboard shortcuts |
| `sortablejs` | `1.15.7` | Drag-and-drop lists |
| `validate.js` | `0.13.1` | Declarative form validation |
| `purecss` | `3.0.0` | (rarely used) |
| `utif2` | `4.1.0` | TIFF decoding (DICOM) |
| `underscore` | `1.13.8` | Utility belt |
| `@eastdesire/jscolor` | `2.5.2` | Color picker |
| `@fortawesome/fontawesome-free` | `6.7.2` | Icons |

### 3.2 napa packages (non-npm)

```json
"napa": {
    "bootstrap-rtl": "https://github.com/PerseusTheGreat/bootstrap-4-rtl/...zip",
    "jquery-creditcardvalidator": "https://github.com/PawelDecowski/.../v1.1.0.tar.gz",
    "jquery-panelslider": "https://github.com/eduardomb/.../1.0.0.tar.gz",
    "jquery-ui": "https://jqueryui.com/.../jquery-ui-1.12.1.zip",
    "jquery-ui-themes": "https://jqueryui.com/.../jquery-ui-themes-1.12.1.zip",
    "literallycanvas": "https://github.com/literallycanvas/.../v0.4.14.tar.gz",
    "react": "https://github.com/facebook/react/.../react-15.1.0.zip",
    "lforms": "https://clinicaltables.nlm.nih.gov/lforms-versions/lforms-33.0.0.zip"
}
```

### 3.3 Dev dependencies

```
eslint 9.39.4                stylelint 16.26.1
jest 29.7.0                  stylelint-config-sass-guidelines 12.1.0
gulp 4.0.2                   stylelint-scss 6.14.0
gulp-dart-sass 1.1.0         @types/jest 29.5.14
gulp-csso 4.0.1              del 6.1.1
gulp-postcss 10.0.0          napa 3.0.0
autoprefixer 10.4.27         postcss 8.5.8
colors 1.4.0                 minimist 1.2.8
eslint-plugin-import 2.32.0  replace-in-file 7.2.0
eslint-plugin-jest 28.14.0   glob 11.1.0
```

---

## 4. Build Pipeline (Gulp 4 + SASS)

> Source: `gulpfile.js` (593 lines)

OpenEMR does **not** use a JS bundler (no webpack/rollup/esbuild). The
frontend "build" is two things: (a) **copy** pre-built library files from
`node_modules/` into `public/assets/`, and (b) **compile SASS** into
`public/themes/`.

### 4.1 Scripts (`package.json`)

```bash
npm run build          # gulp -b               (production)
npm run gulp-build     # gulp -b --dev         (one-off dev)
npm run dev            # gulp --dev && gulp watch   (watch + dev flags)
npm run gulp-watch     # gulp watch
npm test               # jest
npm run lint:js        # eslint '**/*.js' --quiet
npm run lint:js-fix    # eslint --fix
npm run stylelint      # npx stylelint '**/*.{css,scss}'
npm run stylelint-fix  # stylelint --fix
```

`postinstall` runs `napa && gulp -i` — fetches napa packages and runs the
**install** task (asset copy) automatically.

### 4.2 Gulp tasks

| Task | Trigger | Purpose |
|---|---|---|
| `install` (`-i`) | `npm run postinstall`, first install | Copy `node_modules/<pkg>/dist/**` → `public/assets/<pkg>/dist/`. Special handling for `dwv` (dist+decoders+locales), `bootstrap*` (dist+scss), `@fortawesome/fontawesome-free` (css+scss+webfonts), `moment` (min+root). |
| `clean` | Default chain | `del.sync('public/themes/*')` |
| `ingest` | Default chain | Parse CLI args (booleans vs strings) |
| `styles_*` | Default chain | SASS compile each of 7 SCSS groups to `public/themes/`: `style_uni`, `style_color`, `style_tabs`, `style_other`, `misc`, plus `rtl_*` variants and `*_compact` variants. |
| `sync` | Default chain | Copy `interface/themes/*.php` (unchanged) and `*.css` (autoprefixed) → `public/themes/` |
| `watch` | `gulp watch` | Watch `interface/**/*.scss` → re-run `styles`. Watch `interface/themes/*.php` → copy. Watch `interface/themes/*.css` → autoprefix + copy. |

Each SCSS source gets prepended a banner comment:

```css
/*! This style sheet was autogenerated using gulp + scss
 *  For usage instructions, see: https://github.com/openemr/openemr/blob/master/interface/README.md
 */
```

The default chain is `gulp.series(clean, ingest, styles, sync)`.

### 4.3 SCSS source locations (`gulpfile.js` `config.src.styles`)

```
interface/themes/tabs_style_*.scss
interface/themes/oe-styles/style_*.scss
interface/themes/colors/*.scss
interface/themes/directional.scss
interface/themes/misc/**/*.scss
interface/themes/style*.scss
```

Output:
```
public/themes/style_*.css
public/themes/colors/*.css
public/themes/rtl_*.css        (prepends $dir: rtl)
public/themes/compact_*.css   (renamed via gulp-rename)
public/themes/misc/*.css
```

### 4.4 Browser support (`package.json` `browserslist`)

```
> 1%, ie >= 8, edge >= 15, ie_mob >= 10, ff >= 45,
chrome >= 45, safari >= 7, opera >= 23, ios >= 7,
android >= 4, bb >= 10
```

---

## 5. Database

> See `database/schema-overview.md` and `database/connection-layer.md` for
> full detail.

| Item | Value | Source |
|---|---|---|
| Engine | MySQL 5.7+ / MariaDB 10.3+ | `Dockerfile`, docs |
| Charset | `utf8mb4` | `src/BC/DatabaseConnectionFactory.php` (`SET NAMES utf8mb4`, `set_charset`) |
| Collation | `utf8mb4_general_ci` default | `sql/database.sql` (legacy sections) / `utf8mb4_0900_ai_ci` for new tables |
| PHP driver | `pdo_mysql` (Doctrine DBAL 4) **or** `mysqli` (ADODB) | `composer.json` `ext-pdo_mysql`, `ext-mysqli` |
| ORM | None — raw SQL with thin helpers | `library/sql.inc.php`, `src/Common/Database/QueryUtils.php` |
| Schema | ~280 tables across 15,382 lines | `sql/database.sql` |
| Current `v_database` | **535** | `version.php` |

---

## 6. Testing Stack

| Tool | Version | Purpose |
|---|---|---|
| PHPUnit | `^11.0` | Unit + integration tests |
| `phpunit/php-code-coverage` | `^11.0` | Coverage driver |
| `phpunit-isolated.xml` | — | Config for tests that do not need a DB |
| `phpunit.xml` / `phpunit.integration.xml` | — | DB-backed tests |
| `symfony/panther` | `^2.0` | Browser-based E2E (in PHP) |
| Jest | `29.7.0` | JavaScript tests |
| `phpstan/phpstan` | `^2.1` | Static analysis, **level 10** |
| `phpstan/phpstan-strict-rules` | `^2.0` | Stricter static rules |
| `phpstan/phpstan-deprecation-rules` | `^2.0` | Deprecation checks |
| `phpstan/phpstan-phpunit` | `^2.0` | PHPUnit integration |
| `shipmonk/phpstan-baseline-per-identifier` | `^2.3` | Per-identifier baseline |
| `maglnet/composer-require-checker` | `^4.0` | Detect undeclared dependencies |
| `rector/rector` | `^2.1` | Code modernization |
| `slevomat/coding-standard` | `^8.28` | Extra phpcs rules |
| `squizlabs/php_codesniffer` | `^4.0` | phpcs |
| `ergebnis/composer-normalize` | `^2.48` | Normalize composer.json |
| `iamcal/sql-parser` | `^0.7.0` | Custom SQL upgrade parser testing |
| `ramsey/conventional-commits` | `^1.5` | Commit message validation |
| ESLint | `9.39.4` | JS linting |
| Stylelint | `16.26.1` | CSS/SCSS linting |
| Codespell | (CLI) | Spell check |

**PHPStan level 10** is the strictest level. Custom rules in
`tests/PHPStan/Rules/` (registered via `OpenEMR\PHPStan\Rules\` PSR-4 mapping)
enforce project conventions: forbidden globals, forbidden direct
instantiations, namespace rules, etc.

---

## 7. Templating

Two engines are used simultaneously:

| Engine | Use | Sample entry points |
|---|---|---|
| **Twig 3** | Modern pages, login, OAuth2 flow, OAuth2 consent, unauthorized | `templates/login/login.html.twig`, `templates/oauth2/...`, `templates/core/base.html.twig` |
| **Smarty 4.5** | Legacy controllers (`C_*`), some patient chart fragments | `controllers/C_Document.class.php`, `controllers/C_Prescription.class.php` |
| **Raw PHP** | Hundreds of legacy UI files; many include Smarty from PHP | `interface/patient_file/summary/demographics.php` |

The `templates/` folder is organized by domain:
`templates/{core,login,interface,oauth2,encounter,patient,prescription,documents,payments,portal,...}/`.

Twig templates are tested with two layers of isolated tests:
1. **Compilation** — every `.twig` file is parsed and validated against
   registered filters/functions/tests.
2. **Render** — specific templates are rendered with known parameters and
   diffed against fixture files in
   `tests/Tests/Isolated/Common/Twig/fixtures/render/`. Update fixtures with
   `composer update-twig-fixtures`.

---

## 8. Interop Standards

- **FHIR R4** (4.0.1) — `src/FHIR/R4/`
- **US Core 8.0**
- **SMART on FHIR v2.2** — `src/FHIR/SMART/`
- **Bulk Data Access** (`$export`) — `src/Services/FHIR/Export/`
- **CCDA** (custom generator) — `ccdaservice/`
- **CCR** (Continuity of Care Record) — `ccr/`
- **QRDA** — `src/Services/Qrda/`
- **X12** (270/271, 276/277, 278, 837P/I, 835, 999) — `library/billing_sftp_service.php`, `src/Billing/`
- **NCPDP SCRIPT** (e-prescribe) — `interface/eRx*.php`, `interface/eRxSOAP.php`
- **HL7 v2** (labs) — `library/classes/HL7*.class.php`
- **OAuth 2.0** + **OIDC** — `oauth2/`, `src/RestControllers/AuthorizationController.php`
- **RFC 7523** (JWT client assertion) — `src/Services/JWTClientAuthenticationService.php`

---

## 9. Version Constants

`version.php` keeps the canonical version numbers:

| Constant | Current | Used for |
|---|---|---|
| `$v_major` | `8` | Display |
| `$v_minor` | `0` | Display |
| `$v_patch` | `1` | Display |
| `$v_tag` | `-dev` | Display |
| `$v_realpatch` | `0` | Real patch (incremented when releasing a patch for a production version) |
| `$v_database` | `535` | DB upgrade detection (must match `sql/database.sql` v_database comment; CI fails otherwise) |
| `$v_acl` | `12` | ACL upgrade detection |
| `$v_js_includes` | `82` (prod) / `md5(microtime())` (dev) | Cache-bust JS/CSS `?v=N` query strings |

---

## 10. License

**GNU GPL v3.0-or-later.** See `LICENSE` (35,147 bytes).

```
"name": "openemr/openemr",
"license": "GPL-3.0-or-later",
"type": "project"
```

All bundled JS, CSS, and fonts must be GPL-compatible.

---

## 11. See also

- [`overview.md`](./overview.md) — high-level project structure
- [`coding-standards.md`](./coding-standards.md) — PHPCS rules, file headers, commit messages
- [`module-system.md`](./module-system.md) — how modules and bundles fit in
- [`../database/connection-layer.md`](../database/connection-layer.md) — DBAL + ADODB coexistence
- [`../auth/oauth2-server.md`](../auth/oauth2-server.md) — OAuth2 stack
