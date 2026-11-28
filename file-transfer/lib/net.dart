// Logika sieciowa: wykrywanie urządzeń w sieci lokalnej (UDP)
// oraz odbieranie/wysyłanie plików i tekstu (HTTP).
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

const String kAppTag = 'szybki_transfer';
const int kHttpPort = 47820;
const int kDiscoveryPort = 47821;

/// Urządzenie znalezione w sieci.
class Peer {
  Peer({
    required this.id,
    required this.name,
    required this.platform,
    required this.address,
    required this.port,
    this.manual = false,
  }) : lastSeen = DateTime.now();

  final String id;
  String name;
  String platform;
  InternetAddress address;
  int port;
  DateTime lastSeen;
  final bool manual;

  Uri uri(String path) =>
      Uri(scheme: 'http', host: address.address, port: port, path: path);
}

/// Coś, co przyszło od innego urządzenia.
class Received {
  Received.file(this.from, this.path, this.size)
      : text = null,
        time = DateTime.now();
  Received.text(this.from, this.text)
      : path = null,
        size = 0,
        time = DateTime.now();

  final String from;
  final String? path;
  final String? text;
  final int size;
  final DateTime time;

  bool get isFile => path != null;
}

/// Postęp przychodzącego lub wychodzącego transferu.
class TransferProgress {
  TransferProgress(this.label, this.total, {required this.incoming});
  final String label;
  final int total;
  final bool incoming;
  int done = 0;
  double get fraction => total <= 0 ? 0 : min(1, done / total);
}

class TransferService {
  TransferService({
    required this.deviceId,
    required this.deviceName,
    required this.saveDir,
    this.httpPort = kHttpPort,
    this.discoveryPort = kDiscoveryPort,
  });

  final int httpPort;
  final int discoveryPort;

  final String deviceId;
  String deviceName;
  Directory saveDir;
  bool receiving = true;

  final Map<String, Peer> peers = {};
  final List<Received> received = [];
  final Map<int, TransferProgress> active = {};

  /// Wywoływane przy każdej zmianie stanu (lista urządzeń, postęp, nowe pliki).
  final StreamController<void> _changes = StreamController.broadcast();
  Stream<void> get changes => _changes.stream;
  void _notify() {
    if (!_changes.isClosed) _changes.add(null);
  }

  /// Zdarzenia do pokazania użytkownikowi (np. „Odebrano plik X”).
  final StreamController<Received> _incoming = StreamController.broadcast();
  Stream<Received> get incoming => _incoming.stream;

  HttpServer? _http;
  RawDatagramSocket? _udp;
  Timer? _announceTimer;
  int _nextTransferId = 0;

  String get platformName {
    if (Platform.isAndroid) return 'android';
    if (Platform.isWindows) return 'windows';
    if (Platform.isIOS) return 'ios';
    if (Platform.isMacOS) return 'macos';
    return 'linux';
  }

  Future<void> start() async {
    await saveDir.create(recursive: true);
    _http = await HttpServer.bind(InternetAddress.anyIPv4, httpPort);
    _http!.listen(_handleRequest, onError: (_) {});

    _udp = await RawDatagramSocket.bind(
        InternetAddress.anyIPv4, discoveryPort,
        reuseAddress: true);
    _udp!.broadcastEnabled = true;
    _udp!.listen((event) {
      if (event == RawSocketEvent.read) {
        Datagram? d;
        while ((d = _udp!.receive()) != null) {
          _handleDatagram(d!);
        }
      }
    });

    _announceTimer =
        Timer.periodic(const Duration(seconds: 3), (_) => announce());
    announce();
  }

  Future<void> dispose() async {
    _announceTimer?.cancel();
    _udp?.close();
    await _http?.close(force: true);
    await _changes.close();
    await _incoming.close();
  }

  // ---------------------------------------------------------------- odkrywanie

  List<int> _helloPacket(String type) => utf8.encode(jsonEncode({
        'app': kAppTag,
        'v': 1,
        'type': type,
        'id': deviceId,
        'name': deviceName,
        'platform': platformName,
        'port': httpPort,
      }));

  /// Wysyła ogłoszenie „jestem tutaj” na adresy rozgłoszeniowe sieci.
  Future<void> announce() async {
    final udp = _udp;
    if (udp == null) return;
    final packet = _helloPacket('hello');
    final targets = <String>{'255.255.255.255'};
    try {
      final ifaces = await NetworkInterface.list(
          type: InternetAddressType.IPv4, includeLoopback: false);
      for (final iface in ifaces) {
        for (final addr in iface.addresses) {
          final p = addr.address.split('.');
          if (p.length == 4) targets.add('${p[0]}.${p[1]}.${p[2]}.255');
        }
      }
    } catch (_) {}
    for (final t in targets) {
      try {
        udp.send(packet, InternetAddress(t), discoveryPort);
      } catch (_) {}
    }
    // Usuń urządzenia, które dawno się nie odezwały.
    final cutoff = DateTime.now().subtract(const Duration(seconds: 12));
    final before = peers.length;
    peers.removeWhere((_, p) => !p.manual && p.lastSeen.isBefore(cutoff));
    if (peers.length != before) _notify();
  }

  void _handleDatagram(Datagram d) {
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(utf8.decode(d.data)) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    if (msg['app'] != kAppTag) return;
    final id = msg['id'] as String?;
    if (id == null || id == deviceId) return;
    _upsertPeer(id, msg, d.address);
    // Odpowiedz bezpośrednio, żeby druga strona też nas znalazła, nawet jeśli
    // jej system (np. Android) nie przepuszcza pakietów rozgłoszeniowych.
    if (msg['type'] == 'hello') {
      try {
        _udp?.send(_helloPacket('reply'), d.address, discoveryPort);
      } catch (_) {}
    }
  }

  void _upsertPeer(String id, Map<String, dynamic> msg, InternetAddress addr) {
    final name = (msg['name'] as String?) ?? 'Urządzenie';
    final platform = (msg['platform'] as String?) ?? '';
    final port = (msg['port'] as int?) ?? kHttpPort;
    final existing = peers[id];
    if (existing != null) {
      final changed = existing.name != name ||
          existing.address.address != addr.address;
      existing
        ..name = name
        ..platform = platform
        ..address = addr
        ..port = port
        ..lastSeen = DateTime.now();
      if (changed) _notify();
    } else {
      // Jeśli to urządzenie było dodane ręcznie po IP, zastąp wpis ręczny.
      peers.removeWhere((_, p) => p.manual && p.address.address == addr.address);
      peers[id] = Peer(
          id: id, name: name, platform: platform, address: addr, port: port);
      _notify();
    }
  }

  /// Ręczne dodanie urządzenia po adresie IP (gdy automatyczne wykrywanie
  /// nie działa, np. przez ustawienia routera).
  Future<Peer> addManual(String host) async {
    final addr = InternetAddress(host.trim());
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
    try {
      final req = await client
          .getUrl(Uri(scheme: 'http', host: addr.address, port: kHttpPort, path: '/ping'));
      final res = await req.close().timeout(const Duration(seconds: 4));
      final body = await res.transform(utf8.decoder).join();
      final msg = jsonDecode(body) as Map<String, dynamic>;
      if (msg['app'] != kAppTag) throw const FormatException();
      final id = msg['id'] as String;
      peers[id] = Peer(
        id: id,
        name: msg['name'] as String? ?? addr.address,
        platform: msg['platform'] as String? ?? '',
        address: addr,
        port: kHttpPort,
        manual: true,
      );
      _notify();
      return peers[id]!;
    } finally {
      client.close(force: true);
    }
  }

  // ------------------------------------------------------------------ odbiór

  Future<void> _handleRequest(HttpRequest req) async {
    final res = req.response;
    try {
      final path = req.uri.path;
      if (req.method == 'GET' && path == '/ping') {
        res.headers.contentType = ContentType.json;
        res.write(jsonEncode({
          'app': kAppTag,
          'id': deviceId,
          'name': deviceName,
          'platform': platformName,
        }));
      } else if (req.method == 'POST' && path == '/file') {
        await _receiveFile(req);
      } else if (req.method == 'POST' && path == '/text') {
        await _receiveText(req);
      } else {
        res.statusCode = HttpStatus.notFound;
      }
    } catch (e) {
      try {
        res.statusCode = HttpStatus.internalServerError;
        res.write('$e');
      } catch (_) {}
    } finally {
      try {
        await res.close();
      } catch (_) {}
    }
  }

  String _senderName(HttpRequest req) {
    final raw = req.headers.value('x-sender');
    if (raw == null) return req.connectionInfo?.remoteAddress.address ?? '?';
    try {
      return Uri.decodeComponent(raw);
    } catch (_) {
      return raw;
    }
  }

  Future<void> _receiveFile(HttpRequest req) async {
    if (!receiving) {
      req.response.statusCode = HttpStatus.forbidden;
      req.response.write('Odbieranie wyłączone');
      await req.drain<void>();
      return;
    }
    final rawName = req.headers.value('x-filename') ?? 'plik';
    String name;
    try {
      name = Uri.decodeComponent(rawName);
    } catch (_) {
      name = rawName;
    }
    name = sanitizeFileName(name);
    final from = _senderName(req);
    final total = req.contentLength;

    final target = await uniqueFile(saveDir, name);
    final part = File('${target.path}.part');
    final progress = TransferProgress(name, total, incoming: true);
    final tid = _nextTransferId++;
    active[tid] = progress;
    _notify();

    final sink = part.openWrite();
    var lastNotify = DateTime.now();
    try {
      await for (final chunk in req) {
        sink.add(chunk);
        progress.done += chunk.length;
        final now = DateTime.now();
        if (now.difference(lastNotify).inMilliseconds > 150) {
          lastNotify = now;
          _notify();
        }
      }
      await sink.flush();
      await sink.close();
      if (total >= 0 && progress.done != total) {
        throw const HttpException('Transfer przerwany');
      }
      await part.rename(target.path);
      final item = Received.file(from, target.path, progress.done);
      received.insert(0, item);
      _incoming.add(item);
      req.response.write('ok');
    } catch (e) {
      try {
        await sink.close();
      } catch (_) {}
      try {
        await part.delete();
      } catch (_) {}
      rethrow;
    } finally {
      active.remove(tid);
      _notify();
    }
  }

  Future<void> _receiveText(HttpRequest req) async {
    if (!receiving) {
      req.response.statusCode = HttpStatus.forbidden;
      await req.drain<void>();
      return;
    }
    final text = await utf8.decoder.bind(req).join();
    final item = Received.text(_senderName(req), text);
    received.insert(0, item);
    _incoming.add(item);
    _notify();
    req.response.write('ok');
  }

  // ---------------------------------------------------------------- wysyłanie

  /// Wysyła plik z dysku do urządzenia. Rzuca wyjątek przy błędzie.
  Future<void> sendFile(Peer peer, File file) async => sendStream(
      peer, file.uri.pathSegments.last, await file.length(), file.openRead());

  /// Wysyła dane (np. plik wybrany na Androidzie) do urządzenia.
  Future<void> sendStream(
      Peer peer, String name, int length, Stream<List<int>> data) async {
    final progress = TransferProgress(name, length, incoming: false);
    final tid = _nextTransferId++;
    active[tid] = progress;
    _notify();

    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 5);
    try {
      final req = await client.postUrl(peer.uri('/file'));
      req.headers
        ..set('x-filename', Uri.encodeComponent(name))
        ..set('x-sender', Uri.encodeComponent(deviceName))
        ..contentType = ContentType.binary
        ..contentLength = length;
      req.bufferOutput = false;
      var lastNotify = DateTime.now();
      await req.addStream(data.map((chunk) {
        progress.done += chunk.length;
        final now = DateTime.now();
        if (now.difference(lastNotify).inMilliseconds > 150) {
          lastNotify = now;
          _notify();
        }
        return chunk;
      }));
      final res = await req.close();
      final body = await res.transform(utf8.decoder).join();
      if (res.statusCode != 200) {
        throw HttpException(body.isEmpty ? 'Błąd ${res.statusCode}' : body);
      }
    } finally {
      client.close(force: true);
      active.remove(tid);
      _notify();
    }
  }

  Future<void> sendText(Peer peer, String text) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 5);
    try {
      final req = await client.postUrl(peer.uri('/text'));
      req.headers
        ..set('x-sender', Uri.encodeComponent(deviceName))
        ..contentType = ContentType('text', 'plain', charset: 'utf-8');
      req.write(text);
      final res = await req.close();
      await res.drain<void>();
      if (res.statusCode != 200) {
        throw HttpException('Błąd ${res.statusCode}');
      }
    } finally {
      client.close(force: true);
    }
  }
}

// ------------------------------------------------------------------- pomocnicze

/// Usuwa z nazwy pliku ścieżki i znaki niedozwolone w Windows/Android.
String sanitizeFileName(String name) {
  var n = name.replaceAll('\\', '/').split('/').last;
  n = n.replaceAll(RegExp(r'[<>:"|?*\x00-\x1F]'), '_').trim();
  n = n.replaceAll(RegExp(r'^\.+'), '');
  if (n.isEmpty) n = 'plik';
  if (n.length > 200) {
    final dot = n.lastIndexOf('.');
    final ext = dot > 0 && n.length - dot <= 10 ? n.substring(dot) : '';
    n = n.substring(0, 200 - ext.length) + ext;
  }
  return n;
}

/// Zwraca plik o nazwie, która jeszcze nie istnieje: „a.jpg”, „a (1).jpg”, …
Future<File> uniqueFile(Directory dir, String name) async {
  final dot = name.lastIndexOf('.');
  final base = dot > 0 ? name.substring(0, dot) : name;
  final ext = dot > 0 ? name.substring(dot) : '';
  var candidate = File('${dir.path}${Platform.pathSeparator}$name');
  var i = 1;
  while (await candidate.exists() ||
      await File('${candidate.path}.part').exists()) {
    candidate = File('${dir.path}${Platform.pathSeparator}$base ($i)$ext');
    i++;
  }
  return candidate;
}

String formatSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  double v = bytes / 1024;
  var u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return '${v.toStringAsFixed(v < 10 ? 1 : 0)} ${units[u]}';
}

String randomId() {
  final r = Random.secure();
  return List.generate(12, (_) => r.nextInt(16).toRadixString(16)).join();
}
