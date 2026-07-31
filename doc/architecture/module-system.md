# Module System

> **Source paths:** `src/Core/ModulesApplication.php`,
> `src/Core/ModulesClassLoader.php`, `src/Events/Core/ModuleLoadEvents.php`,
> `interface/modules/custom_modules/*/openemr.bootstrap.php`,
> `interface/modules/zend_modules/config/application.config.php`,
> `library/modules.php`
> **Documented version:** OpenEMR 8.0.1-dev

OpenEMR has two parallel module systems, each addressing a different
generation of OpenEMR architecture:

1. **Laminas MVC** (legacy, type 1) — full MVC apps under
   `interface/modules/zend_modules/`. Backed by a DB `modules` table.
2. **Custom modules** (modern, type 0) — drop-in folders under
   `interface/modules/custom_modules/<name>/` with a single bootstrap
   file `openemr.bootstrap.php`. Activated by `mod_active=1` in the
   `modules` table.

Both are wired through `OpenEMR\Core\ModulesApplication` and use the
Symfony EventDispatcher as their primary extension surface.

---

## 1. The `modules` table

Every module — Laminas or custom — has a row in the `modules` table:

| Column | Type | Purpose |
|---|---|---|
| `mod_id` | INT AUTO_INCREMENT PK | Module ID. |
| `mod_name` | VARCHAR | Human name. |
| `mod_directory` | VARCHAR | Folder name under `interface/modules/{zend_modules,custom_modules}`. |
| `mod_active` | TINYINT | 1 = enabled. |
| `mod_ui_active` | TINYINT | 1 = shown in UI menu. |
| `type` | INT | `1` = Laminas, `0` (or any other value) = custom. |
| `date` | DATETIME | Installation timestamp. |
| `mod_ui_order` | INT | Sort order in UI. |

A module's PHP files cannot be executed unless the row exists with
`mod_active=1` (or `mod_ui_active=1`) and the script lives under the
folder registered in `mod_directory`. Enforced by
`ModulesApplication::checkModuleScriptPathForEnabledModule()`.

---

## 2. `ModulesApplication` (the loader)

> Source: `src/Core/ModulesApplication.php` (260 lines)

```php
namespace OpenEMR\Core;

class ModulesApplication
{
    const MODULE_TYPE_CUSTOM  = 0;
    const MODULE_TYPE_LAMINAS = 1;
    const CUSTOM_MODULE_BOOSTRAP_NAME = 'openemr.bootstrap.php';

    public function __construct(
        Kernel $kernel,
        string $webRootPath,
        string $modulePath,
        string $zendModulePath
    ) {
        $zendConfigurationPath = $webRootPath . '/' . $modulePath . $zendModulePath;
        $customModulePath      = $webRootPath . '/' . $modulePath . "custom_modules/";
        $configuration         = require $zendConfigurationPath . '/config/application.config.php';

        // Build the Laminas ServiceManager + share the Symfony EventDispatcher
        $smConfig = $configuration['service_manager'] ?? [];
        $smConfig = new ServiceManagerConfig($smConfig);
        $serviceManager = new ServiceManager();
        $smConfig->configureServiceManager($serviceManager);
        $serviceManager->setService('ApplicationConfig', $configuration);
        $serviceManager->setService(EventDispatcherInterface::class, $kernel->getEventDispatcher());

        // Load Laminas modules
        $serviceManager->get('ModuleManager')->loadModules();

        // Bootstrap listeners
        $listenersFromAppConfig   = $configuration['listeners'] ?? [];
        $listenersFromConfigService = ($serviceManager->get('config'))['listeners'] ?? [];
        $listeners = array_unique(array_merge($listenersFromConfigService, $listenersFromAppConfig));

        $this->application = $serviceManager->get('Application')->bootstrap($listeners);

        $autoloader = new ModulesClassLoader($webRootPath);
        $this->bootstrapCustomModules($autoloader, $kernel->getEventDispatcher(), $webRootPath, $customModulePath);
    }
    // …
}
```

### 2.1 What it does

1. **Reads** `interface/modules/zend_modules/config/application.config.php`
   to get the Laminas module list + service manager config.
2. **Wires** Laminas's `ServiceManager` to share the Symfony
   `EventDispatcher` (the OpenEMR kernel is the single event bus).
3. **Loads** Laminas modules via `ModuleManager::loadModules()`.
4. **Bootstraps** the configured `listeners` array.
5. **Loads** custom modules (one per `mod_active=1, type != 1` row in
   the `modules` table).
6. **Dispatches** `ModuleLoadEvents::MODULES_LOADED` with the loaded /
   failed list.

### 2.2 `oemr_zend_load_modules_from_db($webRoot, $zendConfigurationPath)`

> Source: `src/Core/ModulesApplication.php` line 119

A helper that queries the `modules` table for the active Laminas modules
(ordered by `mod_ui_order, date`) and returns the list of module names.
Laminas's `ModuleManager` then iterates this list and calls
`Module::getAutoloaderConfig()` and `Module::getConfig()` on each.

### 2.3 Security check — `checkModuleScriptPathForEnabledModule()`

> Source: `src/Core/ModulesApplication.php` line 86

```php
public static function checkModuleScriptPathForEnabledModule(
    $modType, $webRootPath, $modulePath
): void {
    $scriptName = $webRootPath . $_SERVER['SCRIPT_NAME'];
    if (str_starts_with($scriptName, (string) $modulePath)) {
        $type = $modType == self::MODULE_TYPE_LAMINAS ? self::MODULE_TYPE_LAMINAS : '';
        $truncatedPath = substr($scriptName, strlen((string) $modulePath));
        $folderName = strtok($truncatedPath, '/');
        if ($folderName !== false) {
            $resultSet = sqlStatementNoLog(
                "SELECT mod_name, mod_directory FROM modules "
                . " WHERE (mod_active = 1 OR mod_ui_active = 1) AND type = ? AND mod_directory = ? ",
                [$type, $folderName]
            );
            $row = sqlFetchArray($resultSet);
            if (empty($row)) {
                throw new AccessDeniedException(
                    "admin", "super",
                    "Access to module path for disabled module is denied"
                );
            }
        }
    }
}
```

This guard is called **before** including a custom module's bootstrap
file and **before** handing off to Laminas's ModuleManager. It prevents
a request to a disabled module's PHP file from succeeding.

---

## 3. Custom module pattern

### 3.1 Layout

```
interface/modules/custom_modules/
├── oe-module-faxsms/
│   ├── openemr.bootstrap.php    ★ Required
│   ├── composer.json
│   ├── package.json
│   ├── public/                  JS / CSS / images
│   ├── src/                     PSR-4 source
│   ├── templates/               Twig
│   ├── .phpstan/                PHPStan stubs
│   └── …
├── oe-module-weno/
├── oe-module-prior-authorizations/
├── oe-module-ehi-exporter/
├── oe-module-dorn/
├── oe-module-comlink-telehealth/
├── oe-module-dashboard-context/
└── oe-module-claimrev-connect/
```

### 3.2 `openemr.bootstrap.php` — the entry point

The single required file. Loaded with `include` (not `require`) so a
throw in the file is caught and the module is force-disabled.

Typical contents:

```php
<?php

/**
 * OpenEMR bootstrap for <module name>.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE
 */

use OpenEMR\Events\Main\TopMenuRenderEvent;
use OpenEMR\Events\Patient\PatientCreatedEvent;
use OpenEMR\Events\Patient\PatientUpdatedEvent;
use OpenEMR\Services\Globals\GlobalConfig;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

/**
 * @var EventDispatcherInterface $eventDispatcher
 * Globally injected by ModulesApplication before include.
 */
global $eventDispatcher;

// 1. Register a PSR-4 autoloader for the module's src/
$autoloader = new \OpenEMR\Core\ModulesClassLoader(__DIR__);
$autoloader->register();

// 2. Register the module's "public/" as an asset source
$assetLoader = new \OpenEMR\Core\AssetLoader(__DIR__ . '/public');
$assetLoader->register();

// 3. Subscribe to events
$eventDispatcher->addListener(TopMenuRenderEvent::EVENT_NAME, function (TopMenuRenderEvent $event) {
    $event->addMenuItem([
        'href' => '../public/.../index.php',
        'label' => xlt('Fax / SMS'),
        'icon' => 'fa-envelope',
    ]);
});

$eventDispatcher->addListener(PatientCreatedEvent::EVENT_NAME, function (PatientCreatedEvent $event) {
    $patient = $event->getPatient();
    // do something with the new patient
});

// 4. (Optionally) register Symfony console commands
$commandClasses = [...];
foreach ($commandClasses as $cmd) {
    ServiceContainer::getCommandRunner()->register($cmd);
}
```

The bootstrap has access to:
- `$eventDispatcher` (Symfony, **injected as a global** before include)
- The full `$GLOBALS` (via `OEGlobalsBag::getInstance()`)
- The database (ADODB is already connected)
- The autoloader
- All services (`(new \OpenEMR\Services\PatientService())->…`)

### 3.3 Failure handling

```php
private function loadCustomModule(
    ModulesClassLoader $classLoader,
    $module,
    EventDispatcherInterface $eventDispatcher,
): void {
    try {
        include $module['path'] . '/' . attr(self::CUSTOM_MODULE_BOOSTRAP_NAME);
    } catch (\Throwable $exception) {
        error_log(errorLogEscape($exception->getMessage()));
    }
}
```

`bootstrapCustomModules()` retries the include 3× with 50 ms sleeps
(`isFileReadableWithRetry`). If still unreadable, the module is
**force-disabled** in the DB:

```php
sqlStatementNoLog("UPDATE modules SET mod_active = 0 WHERE mod_directory = ? AND type != 1", [$row['mod_directory']]);
```

### 3.4 `ModuleLoadEvents::MODULES_LOADED`

After all custom modules have been loaded, `ModulesApplication` dispatches
`ModuleLoadEvents::MODULES_LOADED` with the list of loaded + failed
modules:

```php
$eventDispatcher->dispatch(
    new ModuleLoadEvents($db_modules, $failed_modules),
    ModuleLoadEvents::MODULES_LOADED
);
```

Modules can listen to this to e.g. log to their own monitoring
infrastructure.

---

## 4. Bundled custom modules (8 of them)

| Module | Folder | Purpose |
|---|---|---|
| **oe-module-faxsms** | `oe-module-faxsms/` | Outbound fax + SMS via RingCentral, SignalWire, or Twilio. Adds menu items to the main nav. |
| **oe-module-weno** | `oe-module-weno/` | Weno e-prescribing integration. |
| **oe-module-prior-authorizations** | `oe-module-prior-authorizations/` | Prior authorization workflows (X12 278). |
| **oe-module-ehi-exporter** | `oe-module-ehi-exporter/` | EHI (Electronic Health Information) export — `$export` UI in admin. |
| **oe-module-dorn** | `oe-module-dorn/` | Dorn Technology lab integration. |
| **oe-module-comlink-telehealth** | `oe-module-comlink-telehealth/` | ComLink TeleHealth video integration. |
| **oe-module-dashboard-context** | `oe-module-dashboard-context/` | Dashboard context providers (extra cards on the patient dashboard). |
| **oe-module-claimrev-connect** | `oe-module-claimrev-connect/` | ClaimRev Connect clearinghouse integration. |

Plus the legacy `modules/sms_email_reminder/` (the original
"classic" module that predates the modern `custom_modules` directory).

---

## 5. Laminas modules (legacy, `interface/modules/zend_modules/`)

The legacy module system is full Laminas MVC. Each module has:

```
zend_modules/module/<ModuleName>/
├── config/
│   └── module.config.php     routes, service_manager, controllers
├── src/
│   ├── Controller/          Action controllers
│   ├── Form/                Laminas forms
│   ├── Model/               Table gateways
│   └── Service/             Services
├── view/                    phtml templates
└── Module.php               Module class with getAutoloaderConfig() and getConfig()
```

The active module list is loaded by `oemr_zend_load_modules_from_db()`
from the `modules` table. The Module class is instantiated by Laminas
and asked for its config.

---

## 6. Event catalog

> OpenEMR uses **Symfony EventDispatcher** as its primary extension point.
> ~80 event classes in `src/Events/`. Modules subscribe and modify
> behavior. Each event has a constant `EVENT_NAME` (the dispatch key)
> and a `class`.

### 6.1 Top-level event sub-namespaces

```
src/Events/
├── AbstractBoundFilterEvent.php
├── BoundFilter.php
├── Appointsments/        (typo — kept for backward compat)
├── Billing/
├── CDA/
├── Codes/
├── Command/
├── Core/                 Module load, SQL upgrade, template page, sanitize, style, script filter
├── Encounter/
├── Facility/
├── Globals/              GlobalsInitializedEvent
├── Main/                 Top menu, body render, hooks
├── Messaging/
├── Patient/              Before/After Created/Updated
├── PatientDemographics/
├── PatientDocuments/
├── PatientFinder/
├── PatientPortal/
├── PatientReport/
├── PatientSelect/
├── RestApiExtend/
├── Services/
├── User/
└── UserInterface/
```

### 6.2 Core events (the "always-on" surface)

| Event class | Dispatch key | Fired by | Use |
|---|---|---|---|
| `OpenEMR\Events\Core\ModuleLoadEvents` | `modules.loaded` | `ModulesApplication` | After all modules are loaded. |
| `OpenEMR\Events\Core\SQLUpgradeEvent` | `sql.upgrade` | `SQLUpgradeService` | During DB upgrade. |
| `OpenEMR\Events\Core\TemplatePageEvent` | `template.page.render` | Page renderer | Render a custom block in a page. |
| `OpenEMR\Events\Core\TwigEnvironmentEvent` | `twig.environment` | `TwigContainer` | Customize the Twig environment. |
| `OpenEMR\Events\Core\StyleFilterEvent` | `style.filter` | Asset loader | Modify CSS. |
| `OpenEMR\Events\Core\ScriptFilterEvent` | `script.filter` | Asset loader | Modify JS. |
| `OpenEMR\Events\Core\Sanitize\…` | various | Sanitizers | Pre/post sanitization hooks. |

### 6.3 Patient events

| Event class | Fired when |
|---|---|
| `BeforePatientCreatedEvent` | Before `INSERT` (cancellable via `$event->cancel()`). |
| `PatientCreatedEvent` | After successful `INSERT`. |
| `BeforePatientUpdatedEvent` | Before `UPDATE`. |
| `PatientUpdatedEvent` | After successful `UPDATE`. |
| `PatientDemographicsRenderEvent` | When rendering the demographics page. |
| `PatientFinderFilterEvent` | When searching for a patient. |
| `PatientSelectRenderEvent` | When rendering the patient picker. |
| `PatientReportFilterEvent` | When rendering a patient report. |
| `PatientDocumentEvents` | When creating/updating/deleting patient documents. |

### 6.4 Encounter events

| Event class | Fired when |
|---|---|
| `Encounter\EncounterCreatedEvent` | New visit created. |
| `Encounter\EncounterUpdatedEvent` | Visit updated. |
| `Encounter\EncounterFilterEvent` | When filtering encounters. |

### 6.5 Main / UI events

| Event class | Fired when |
|---|---|
| `Main\TopMenuRenderEvent` | Top of the main app shell. Modules add menu items. |
| `Main\BodyRenderEvent` | Body of the main app. |
| `Main\HooksRenderEvent` | Render-time hooks. |
| `Main\TabsRenderEvent` | Tab chrome. |

### 6.6 Globals events

| Event class | Fired when |
|---|---|
| `Globals\GlobalsInitializedEvent` | After `library/globals.inc.php` finishes. |

### 6.7 Messaging events

| Event class | Fired when |
|---|---|
| `Messaging\NewMessageEvent` | New message sent. |
| `Messaging\MessageReadEvent` | Message read. |

### 6.8 REST API extension events

| Event class | Fired when |
|---|---|
| `RestApiExtend\ApiRequestEvent` | Before REST request handling. |
| `RestApiExtend\ApiResponseEvent` | After REST response. |

### 6.9 User events

| Event class | Fired when |
|---|---|
| `User\UserCreatedEvent` | New user account. |
| `User\UserUpdatedEvent` | User updated. |
| `User\UserDeletedEvent` | User deleted. |

### 6.10 Filter events (extending a query)

The `AbstractBoundFilterEvent` + `BoundFilter` pattern lets modules
inject extra `WHERE` conditions into a service's `search()` call:

```php
$eventDispatcher->addListener(
    AppointmentsFilterEvent::EVENT_NAME,
    function (AppointmentsFilterEvent $event) {
        $event->addBoundFilter(new BoundFilter('provider_id', '=', $_SESSION['authUserID']));
    }
);
```

Bound filters apply to:
- `AppointmentsFilterEvent` (appointments search)
- `PatientFinderFilterEvent` (patient search)
- `PatientReportFilterEvent`
- `EncounterFilterEvent`
- `GenericFilterEvent` (custom)

### 6.11 Services events (low-level)

| Event class | Fired when |
|---|---|
| `Services\ServiceSaveEvent` | Generic service save (pre/post). |
| `Services\ServiceCreateEvent` | Generic service create. |
| `Services\ServiceUpdateEvent` | Generic service update. |
| `Services\ServiceDeleteEvent` | Generic service delete. |

These are fired by service classes that opt into the pattern (rarely
used; most services fire domain-specific events like `PatientCreatedEvent`).

### 6.12 Coding rules for events

- All event classes extend `Symfony\Contracts\EventDispatcher\Event`.
- The class defines a `const EVENT_NAME = '…'` — this is the dispatch key.
- Use `Symfony\Component\EventDispatcher\EventDispatcherInterface::dispatch($event, $event::EVENT_NAME)`.
- Listeners may be closures, invokables, or services. The kernel supports
  tagged services and constructor injection.
- Cancellable events (e.g. `BeforePatientCreatedEvent`) expose
  `$event->cancel()` + `$event->isCancelled()`.

---

## 7. ModuleManager (Laminas)

> Source: `interface/modules/zend_modules/config/application.config.php`

Each Laminas module has a `Module.php`:

```php
namespace <Vendor>\<Name>;

class Module
{
    public function getAutoloaderConfig(): array
    {
        return [
            'Zend\Loader\ClassMapAutoloader' => [__DIR__ . '/autoload_classmap.php'],
            'Zend\Loader\StandardAutoloader' => [
                'namespaces' => [
                    __NAMESPACE__ => __DIR__ . '/src/' . __NAMESPACE__,
                ],
            ],
        ];
    }

    public function getConfig(): array
    {
        return include __DIR__ . '/config/module.config.php';
    }

    public function onBootstrap(MvcEvent $e)
    {
        // wire up ACL, layouts, etc.
    }
}
```

The Module class is instantiated during
`ModuleManager::loadModules()`. OpenEMR bridges the Laminas event manager
to the Symfony EventDispatcher so modules can dispatch Symfony events
from inside Laminas code paths.

---

## 8. Module installation

A module is installed by:

1. **Copying** its folder under `interface/modules/custom_modules/<name>/`.
2. **Running** the install SQL (the module ships an `install.sql`).
3. **Inserting** a row into the `modules` table:
   ```sql
   INSERT INTO modules (mod_name, mod_directory, mod_active, mod_ui_active, type, date, mod_ui_order)
   VALUES ('My Module', 'my-module', 1, 1, 0, NOW(), 100);
   ```
   Note `type = 0` (not 1 — custom, not Laminas).
4. **Logging out and back in** (the modules list is cached for the
   session).

Many modules ship a `setup.php` (or `install.php`) that runs the SQL
and inserts the row automatically. The custom module installer can also
be invoked from `interface/super/modules/` (the admin module manager).

---

## 9. Anti-patterns

| Anti-pattern | What to do |
|---|---|
| `require_once '../my_module/foo.php'` from a global | Use the `openemr.bootstrap.php` and let `ModulesClassLoader` autoload your `src/`. |
| Disabling security in the bootstrap | Always call `checkModuleScriptPathForEnabledModule` for direct script entry. |
| Hardcoding the module ID | Use the `modules` table to look it up by `mod_directory`. |
| Reading `$GLOBALS` directly | Use `OEGlobalsBag::getInstance()->getXxx()`. |
| Modifying core files | Dispatch an event and let a listener do the customization. |
| Disabling a module without writing to `modules` | Always `UPDATE modules SET mod_active = 0` to persist. |
| Using `sqlStatement` | Use `QueryUtils` instead. |

---

## 10. See also

- [`overview.md`](./overview.md) — overall layout
- [`bootstrap-flow.md`](./bootstrap-flow.md) — when modules load
- [`service-layer.md`](./service-layer.md) — services that dispatch events
- [`../auth/oauth2-server.md`](../auth/oauth2-server.md) — events fired by OAuth2 flow
- `src/Events/` — full event catalog
- `src/Core/ModulesApplication.php` — the loader
