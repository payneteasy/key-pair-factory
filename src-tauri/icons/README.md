# PaynetEasy · API Key Pair Factory — иконки для Tauri

Набор сгенерирован из векторного исходника (1024×1024). Базовая иконка —
**тёмный squircle** (`icon.png`): у неё своя подложка, поэтому она одинаково
хорошо смотрится и в светлой, и в тёмной системной теме.

```
src-tauri/icons/
├── icon.png              1024×1024  — мастер-исходник (Linux + источник)
├── icon.ico              Windows    (16,24,32,48,64,128,256 в одном файле)
├── icon.icns             macOS      (16…1024 в одном файле)
├── 32x32.png             Linux / общий
├── 128x128.png           Linux / общий
├── 128x128@2x.png        256×256, retina
├── StoreLogo.png         50×50      — Microsoft Store
├── Square30x30Logo.png … Square310x310Logo.png   — пакет Microsoft Store (MSIX)
├── light/                ← опционально: светлый squircle (для светлой темы)
│   ├── 32x32.png  128x128.png  128x128@2x.png  512x512.png  1024x1024.png
└── tray/                 ← иконки трея/меню-бара, адаптивные под тему
    ├── tray-on-dark.png     (светлый знак — для ТЁМНОГО меню-бара)
    ├── tray-on-dark@2x.png
    ├── tray-on-light.png    (тёмный знак — для СВЕТЛОГО меню-бара)
    └── tray-on-light@2x.png
```

## 1. Подключение в `tauri.conf.json`

```jsonc
{
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

`StoreLogo.png` и `Square*Logo.png` Tauri подхватывает автоматически при сборке
пакета для **Microsoft Store** — их не нужно перечислять в массиве `icon`.

## 2. Тёмная / светлая тема

Иконка **приложения** (Dock, панель задач, лаунчер) в системе одна и не
переключается ОС автоматически — тёмный squircle для этого и сделан
(работает на любом фоне). Переключать под тему имеет смысл **иконку трея**
(меню-бар macOS / system tray), где фон зависит от темы:

- тёмный меню-бар → светлый знак → `tray/tray-on-dark.png`
- светлый меню-бар → тёмный знак → `tray/tray-on-light.png`

### Rust (Tauri v2) — выбор иконки трея по теме

```rust
use tauri::{
    tray::TrayIconBuilder,
    image::Image,
    Manager, Theme, WindowEvent,
};

fn tray_icon(theme: Theme) -> &'static str {
    match theme {
        Theme::Dark => "icons/tray/tray-on-dark.png",  // светлый знак
        _           => "icons/tray/tray-on-light.png", // тёмный знак
    }
}

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let win   = app.get_webview_window("main").unwrap();
    let theme = win.theme().unwrap_or(Theme::Light);

    let tray = TrayIconBuilder::with_id("main")
        .icon(Image::from_path(tray_icon(theme))?)
        .build(app)?;

    // реагируем на смену системной темы
    win.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let _ = tray.set_icon(Some(
                Image::from_path(tray_icon(*theme)).unwrap()
            ));
        }
    });
    Ok(())
}
```

### Светлый вариант иконки приложения

Если для светлой темы хочется именно светлый squircle — пересоберите пакет,
указав в `bundle.icon` файлы из `icons/light/` (полный набор `.icns`/`.ico`
можно догенерировать командой ниже из `light/1024x1024.png`).

## 3. Перегенерация набора

Любой набор можно пересобрать из мастер-PNG штатной командой Tauri:

```bash
npm run tauri icon icons/icon.png        # тёмный squircle
npm run tauri icon icons/light/1024x1024.png   # светлый вариант
```

Команда сама создаёт `.ico`, `.icns`, все PNG и логотипы Microsoft Store.
Для мобильных целей (`tauri icon` с флагом мобильной сборки) она добавит
Android `mipmap-*` и iOS `AppIcon.appiconset`.
