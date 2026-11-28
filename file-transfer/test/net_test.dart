import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:szybki_transfer/net.dart';

void main() {
  late Directory tmp;
  late TransferService a, b;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('st_test');
    a = TransferService(
        deviceId: 'aaa', deviceName: 'Telefon', saveDir: Directory('${tmp.path}/a'),
        httpPort: 47930, discoveryPort: 47931);
    b = TransferService(
        deviceId: 'bbb', deviceName: 'Komputer', saveDir: Directory('${tmp.path}/b'),
        httpPort: 47940, discoveryPort: 47941);
    await a.start();
    await b.start();
  });

  tearDown(() async {
    await a.dispose();
    await b.dispose();
    await tmp.delete(recursive: true);
  });

  Peer peerB() => Peer(id: 'bbb', name: 'Komputer', platform: 'windows',
      address: InternetAddress.loopbackIPv4, port: 47940);

  test('wysyła duży plik w całości, z polskimi znakami w nazwie', () async {
    final rnd = Random(1);
    final data = List<int>.generate(5 * 1024 * 1024 + 123, (_) => rnd.nextInt(256));
    final src = File('${tmp.path}/zdjęcie wakacje.jpg')..writeAsBytesSync(data);

    final got = b.incoming.first;
    await a.sendFile(peerB(), src);
    final r = await got;

    expect(r.from, 'Telefon');
    expect(r.path!.endsWith('zdjęcie wakacje.jpg'), isTrue);
    expect(File(r.path!).readAsBytesSync(), data);
    expect(b.active, isEmpty);
  });

  test('nie nadpisuje plików o tej samej nazwie', () async {
    final src = File('${tmp.path}/a.txt')..writeAsStringSync('x');
    await a.sendFile(peerB(), src);
    await a.sendFile(peerB(), src);
    final names = b.saveDir.listSync().map((e) => e.uri.pathSegments.last).toSet();
    expect(names, {'a.txt', 'a (1).txt'});
  });

  test('wysyła tekst', () async {
    final got = b.incoming.first;
    await a.sendText(peerB(), 'https://example.com ąę');
    expect((await got).text, 'https://example.com ąę');
  });

  test('odmawia, gdy odbiór wyłączony', () async {
    b.receiving = false;
    final src = File('${tmp.path}/a.txt')..writeAsStringSync('x');
    expect(() => a.sendFile(peerB(), src), throwsA(isA<HttpException>()));
  });

  test('ping zwraca dane urządzenia', () async {
    final client = HttpClient();
    final req = await client.getUrl(Uri.parse('http://127.0.0.1:47940/ping'));
    final res = await req.close();
    expect(res.statusCode, 200);
    client.close();
  });

  test('czyści niebezpieczne nazwy plików', () {
    expect(sanitizeFileName('../../etc/passwd'), 'passwd');
    expect(sanitizeFileName(r'C:\x\y:z?.txt'), 'y_z_.txt');
    expect(sanitizeFileName('...'), 'plik');
    expect(sanitizeFileName(''), 'plik');
  });
}
