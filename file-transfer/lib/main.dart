import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:desktop_drop/desktop_drop.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

import 'net.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SzybkiTransferApp());
}

class SzybkiTransferApp extends StatelessWidget {
  const SzybkiTransferApp({super.key});

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF2563EB);
    return MaterialApp(
      title: 'Szybki Transfer',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: seed), useMaterial3: true),
      darkTheme: ThemeData(
          colorScheme:
              ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark),
          useMaterial3: true),
      home: const HomePage(),
    );
  }
}

// ---------------------------------------------------------------- ustawienia

class Settings {
  Settings(this._file, this.id, this.name);
  final File _file;
  final String id;
  String name;

  static Future<Settings> load() async {
    final dir = await getApplicationSupportDirectory();
    await dir.create(recursive: true);
    final file = File('${dir.path}${Platform.pathSeparator}settings.json');
    try {
      final m = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
      return Settings(file, m['id'] as String, m['name'] as String);
    } catch (_) {
      final s = Settings(file, randomId(), _defaultName());
      await s.save();
      return s;
    }
  }

  static String _defaultName() {
    if (Platform.isAndroid) return 'Telefon';
    final host = Platform.localHostname;
    return host.isEmpty || host == 'localhost' ? 'Komputer' : host;
  }

  Future<void> save() =>
      _file.writeAsString(jsonEncode({'id': id, 'name': name}));
}

/// Folder na odebrane pliki: „Pobrane/Szybki Transfer”.
Future<Directory> resolveSaveDir() async {
  const folder = 'Szybki Transfer';
  if (Platform.isAndroid) {
    final public = Directory('/storage/emulated/0/Download/$folder');
    if (await _writable(public)) return public;
    // Starsze Androidy (9 i niżej) wymagają zgody na zapis.
    await Permission.storage.request();
    if (await _writable(public)) return public;
    final ext = await getExternalStorageDirectory();
    return Directory('${(ext ?? await getApplicationDocumentsDirectory()).path}/$folder');
  }
  final candidates = <Future<Directory?> Function()>[
    getDownloadsDirectory,
    () async {
      final home = Platform.environment['USERPROFILE'] ?? Platform.environment['HOME'];
      return home == null ? null : Directory('$home${Platform.pathSeparator}Downloads');
    },
    getApplicationDocumentsDirectory,
    getApplicationSupportDirectory,
  ];
  for (final get in candidates) {
    try {
      final base = await get();
      if (base == null) continue;
      final dir = Directory('${base.path}${Platform.pathSeparator}$folder');
      if (await _writable(dir)) return dir;
    } catch (_) {}
  }
  return Directory('${Directory.systemTemp.path}${Platform.pathSeparator}$folder');
}

Future<bool> _writable(Directory dir) async {
  try {
    await dir.create(recursive: true);
    final probe = File('${dir.path}/.probe');
    await probe.writeAsString('x');
    await probe.delete();
    return true;
  } catch (_) {
    return false;
  }
}

Future<List<String>> localAddresses() async {
  try {
    final ifaces = await NetworkInterface.list(
        type: InternetAddressType.IPv4, includeLoopback: false);
    return [
      for (final i in ifaces)
        for (final a in i.addresses)
          if (!a.address.startsWith('169.254.')) a.address
    ];
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------- ekran główny

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  Settings? _settings;
  TransferService? _service;
  String? _error;
  String? _selectedPeer;
  List<String> _myIps = [];
  bool _dragging = false;
  bool _sending = false;
  StreamSubscription<void>? _changesSub;
  StreamSubscription<Received>? _incomingSub;

  bool get _isDesktop => Platform.isWindows || Platform.isLinux || Platform.isMacOS;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final settings = await Settings.load();
      final dir = await resolveSaveDir();
      final service = TransferService(
          deviceId: settings.id, deviceName: settings.name, saveDir: dir);
      await service.start();
      _changesSub = service.changes.listen((_) {
        if (!mounted) return;
        // Jeśli zaznaczone urządzenie zniknęło, a jest inne — wybierz je.
        if (_selectedPeer != null && !service.peers.containsKey(_selectedPeer)) {
          _selectedPeer = null;
        }
        _selectedPeer ??=
            service.peers.length == 1 ? service.peers.keys.first : null;
        setState(() {});
      });
      _incomingSub = service.incoming.listen(_onIncoming);
      _myIps = await localAddresses();
      setState(() {
        _settings = settings;
        _service = service;
      });
    } on SocketException catch (e) {
      setState(() => _error =
          'Nie udało się uruchomić odbioru (port $kHttpPort zajęty?).\n$e');
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  @override
  void dispose() {
    _changesSub?.cancel();
    _incomingSub?.cancel();
    _service?.dispose();
    super.dispose();
  }

  void _onIncoming(Received r) {
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    if (r.isFile) {
      messenger.showSnackBar(SnackBar(
        content: Text('Odebrano ${_basename(r.path!)} od ${r.from}'),
        action: SnackBarAction(label: 'Otwórz', onPressed: () => _open(r.path!)),
      ));
    } else {
      Clipboard.setData(ClipboardData(text: r.text!));
      messenger.showSnackBar(SnackBar(
          content: Text('Tekst od ${r.from} skopiowany do schowka')));
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg)));
  }

  Peer? get _target {
    final s = _service;
    if (s == null || _selectedPeer == null) return null;
    return s.peers[_selectedPeer];
  }

  // ----------------------------------------------------------------- akcje

  Future<void> _pickAndSend() async {
    final peer = _target;
    if (peer == null) return _toast('Najpierw wybierz urządzenie');
    final files = await FilePicker.pickFiles(dialogTitle: 'Wybierz pliki do wysłania');
    if (files.isEmpty) return;
    await _runSend(() async {
      for (final f in files) {
        final length = f.lengthSync() ?? await f.length() ?? -1;
        final path = f.path;
        if (path != null) {
          await _service!.sendStream(peer, f.name, length, File(path).openRead());
        } else {
          await _service!.sendStream(peer, f.name, length, f.readAsByteStream());
        }
      }
      return files.length;
    });
  }

  Future<void> _sendPaths(List<String> paths) async {
    final peer = _target;
    if (peer == null) return _toast('Najpierw wybierz urządzenie');
    final files = <File>[];
    for (final p in paths) {
      if (await FileSystemEntity.isDirectory(p)) {
        await for (final e in Directory(p).list(recursive: true)) {
          if (e is File) files.add(e);
        }
      } else {
        files.add(File(p));
      }
    }
    if (files.isEmpty) return;
    await _runSend(() async {
      for (final f in files) {
        await _service!.sendFile(peer, f);
      }
      return files.length;
    });
  }

  Future<void> _runSend(Future<int> Function() job) async {
    setState(() => _sending = true);
    try {
      final n = await job();
      _toast(n == 1 ? 'Wysłano plik' : 'Wysłano $n plików');
    } catch (e) {
      _toast('Błąd wysyłania: ${_friendly(e)}');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendText() async {
    final peer = _target;
    if (peer == null) return _toast('Najpierw wybierz urządzenie');
    final clip = await Clipboard.getData(Clipboard.kTextPlain);
    if (!mounted) return;
    final controller = TextEditingController(text: clip?.text ?? '');
    final text = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Wyślij tekst do ${peer.name}'),
        content: SizedBox(
          width: 420,
          child: TextField(
            controller: controller,
            autofocus: true,
            minLines: 3,
            maxLines: 8,
            decoration: const InputDecoration(
                hintText: 'Link, notatka, kod…', border: OutlineInputBorder()),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Anuluj')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, controller.text),
              child: const Text('Wyślij')),
        ],
      ),
    );
    if (text == null || text.isEmpty) return;
    try {
      await _service!.sendText(peer, text);
      _toast('Wysłano tekst');
    } catch (e) {
      _toast('Błąd wysyłania: ${_friendly(e)}');
    }
  }

  Future<void> _addByIp() async {
    final controller = TextEditingController();
    final ip = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Dodaj urządzenie po IP'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Wpisz adres IP widoczny na dole ekranu drugiego urządzenia.'),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                  hintText: 'np. 192.168.1.23', border: OutlineInputBorder()),
              onSubmitted: (v) => Navigator.pop(ctx, v),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Anuluj')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, controller.text),
              child: const Text('Połącz')),
        ],
      ),
    );
    if (ip == null || ip.trim().isEmpty) return;
    try {
      final peer = await _service!.addManual(ip);
      setState(() => _selectedPeer = peer.id);
      _toast('Połączono z ${peer.name}');
    } catch (e) {
      _toast('Nie znaleziono aplikacji pod adresem $ip');
    }
  }

  Future<void> _rename() async {
    final controller = TextEditingController(text: _settings!.name);
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nazwa tego urządzenia'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(border: OutlineInputBorder()),
          onSubmitted: (v) => Navigator.pop(ctx, v),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Anuluj')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, controller.text),
              child: const Text('Zapisz')),
        ],
      ),
    );
    if (name == null || name.trim().isEmpty) return;
    _settings!.name = name.trim();
    _service!.deviceName = name.trim();
    await _settings!.save();
    _service!.announce();
    setState(() {});
  }

  Future<void> _open(String path) async {
    if (Platform.isWindows) {
      await Process.run('explorer', [path]);
    } else {
      final r = await OpenFilex.open(path);
      if (r.type != ResultType.done) _toast('Nie można otworzyć: ${r.message}');
    }
  }

  Future<void> _openFolder() async {
    final dir = _service!.saveDir.path;
    if (Platform.isWindows) {
      await Process.run('explorer', [dir]);
    } else if (Platform.isLinux) {
      await Process.run('xdg-open', [dir]);
    } else {
      _toast('Pliki są w: $dir');
    }
  }

  // ------------------------------------------------------------------- UI

  @override
  Widget build(BuildContext context) {
    final service = _service;
    if (_error != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(_error!, textAlign: TextAlign.center),
          ),
        ),
      );
    }
    if (service == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final body = ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
      children: [
        _sectionTitle('Urządzenia w sieci', trailing: IconButton(
          tooltip: 'Dodaj po adresie IP',
          icon: const Icon(Icons.add_link),
          onPressed: _addByIp,
        )),
        if (service.peers.isEmpty) _searching() else ..._peerTiles(service),
        if (service.active.isNotEmpty) ...[
          const SizedBox(height: 16),
          _sectionTitle('W toku'),
          for (final t in service.active.values) _progressTile(t),
        ],
        const SizedBox(height: 16),
        _sectionTitle('Odebrane', trailing: TextButton.icon(
          onPressed: _openFolder,
          icon: const Icon(Icons.folder_open, size: 18),
          label: const Text('Folder'),
        )),
        if (service.received.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              _isDesktop
                  ? 'Nic jeszcze nie przyszło. Przeciągnij pliki na to okno, aby je wysłać.'
                  : 'Nic jeszcze nie przyszło.',
              style: TextStyle(color: Theme.of(context).colorScheme.outline),
            ),
          )
        else
          for (final r in service.received) _receivedTile(r),
        const SizedBox(height: 24),
        _footer(service),
      ],
    );

    return Scaffold(
      appBar: AppBar(
        title: const Text('Szybki Transfer'),
        actions: [
          TextButton.icon(
            onPressed: _rename,
            icon: Icon(Platform.isAndroid ? Icons.smartphone : Icons.computer,
                size: 18),
            label: Text(_settings!.name),
          ),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'toggle') {
                setState(() => service.receiving = !service.receiving);
              } else if (v == 'clear') {
                setState(service.received.clear);
              }
            },
            itemBuilder: (_) => [
              CheckedPopupMenuItem(
                  value: 'toggle',
                  checked: service.receiving,
                  child: const Text('Odbieraj pliki')),
              const PopupMenuItem(
                  value: 'clear', child: Text('Wyczyść listę odebranych')),
            ],
          ),
        ],
      ),
      body: _isDesktop
          ? DropTarget(
              onDragEntered: (_) => setState(() => _dragging = true),
              onDragExited: (_) => setState(() => _dragging = false),
              onDragDone: (d) {
                setState(() => _dragging = false);
                _sendPaths([for (final f in d.files) f.path]);
              },
              child: Stack(children: [body, if (_dragging) _dropOverlay()]),
            )
          : body,
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52)),
                  onPressed: _target == null || _sending ? null : _pickAndSend,
                  icon: _sending
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.upload_file),
                  label: Text(_target == null
                      ? 'Wybierz urządzenie'
                      : 'Wyślij pliki do ${_target!.name}'),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filledTonal(
                style: IconButton.styleFrom(minimumSize: const Size(52, 52)),
                tooltip: 'Wyślij tekst / schowek',
                onPressed: _target == null ? null : _sendText,
                icon: const Icon(Icons.content_paste),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionTitle(String text, {Widget? trailing}) => Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 4),
        child: Row(children: [
          Expanded(
            child: Text(text,
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
          ),
          ?trailing,
        ]),
      );

  Widget _searching() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.5)),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                  'Szukam urządzeń…\nUruchom aplikację na drugim urządzeniu w tej samej sieci Wi‑Fi.',
                  style: Theme.of(context).textTheme.bodyMedium),
            ),
          ]),
        ),
      );

  List<Widget> _peerTiles(TransferService service) {
    final scheme = Theme.of(context).colorScheme;
    return [
      for (final p in service.peers.values)
        Card(
          color: p.id == _selectedPeer ? scheme.primaryContainer : null,
          child: ListTile(
            leading: Icon(
                p.platform == 'android' || p.platform == 'ios'
                    ? Icons.smartphone
                    : Icons.computer,
                color: p.id == _selectedPeer ? scheme.primary : null),
            title: Text(p.name),
            subtitle: Text(p.address.address),
            trailing: p.id == _selectedPeer
                ? Icon(Icons.check_circle, color: scheme.primary)
                : null,
            onTap: () => setState(() => _selectedPeer = p.id),
          ),
        ),
    ];
  }

  Widget _progressTile(TransferProgress t) => ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(t.incoming ? Icons.download : Icons.upload),
        title: Text(t.label, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 6),
            LinearProgressIndicator(value: t.total > 0 ? t.fraction : null),
            const SizedBox(height: 4),
            Text(t.total > 0
                ? '${formatSize(t.done)} / ${formatSize(t.total)}'
                : formatSize(t.done)),
          ],
        ),
      );

  Widget _receivedTile(Received r) {
    if (r.isFile) {
      return ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.insert_drive_file_outlined),
        title: Text(_basename(r.path!),
            maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text('${formatSize(r.size)} · od ${r.from} · ${_time(r.time)}'),
        onTap: () => _open(r.path!),
      );
    }
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.notes),
      title: Text(r.text!, maxLines: 3, overflow: TextOverflow.ellipsis),
      subtitle: Text('Tekst · od ${r.from} · ${_time(r.time)}'),
      trailing: IconButton(
        tooltip: 'Kopiuj',
        icon: const Icon(Icons.copy),
        onPressed: () {
          Clipboard.setData(ClipboardData(text: r.text!));
          _toast('Skopiowano');
        },
      ),
    );
  }

  Widget _footer(TransferService service) => Text(
        'Moje IP: ${_myIps.isEmpty ? 'brak sieci' : _myIps.join(', ')}\n'
        'Zapis do: ${service.saveDir.path}',
        style: Theme.of(context)
            .textTheme
            .bodySmall
            ?.copyWith(color: Theme.of(context).colorScheme.outline),
      );

  Widget _dropOverlay() {
    final scheme = Theme.of(context).colorScheme;
    return Positioned.fill(
      child: Container(
        margin: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: scheme.primaryContainer.withValues(alpha: 0.9),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: scheme.primary, width: 2),
        ),
        alignment: Alignment.center,
        child: Text(
          _target == null
              ? 'Najpierw wybierz urządzenie'
              : 'Upuść, aby wysłać do ${_target!.name}',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(color: scheme.onPrimaryContainer),
        ),
      ),
    );
  }
}

String _basename(String path) => path.split(RegExp(r'[\\/]')).last;

String _time(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

String _friendly(Object e) {
  if (e is SocketException) return 'brak połączenia z urządzeniem';
  if (e is HttpException) return e.message;
  return '$e';
}
