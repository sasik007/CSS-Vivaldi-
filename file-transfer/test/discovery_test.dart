import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:szybki_transfer/net.dart';

void main() {
  test('dwa urządzenia znajdują się nawzajem przez UDP', () async {
    final tmp = await Directory.systemTemp.createTemp('st_disc');
    final a = TransferService(deviceId: 'aaa', deviceName: 'Telefon',
        saveDir: Directory('${tmp.path}/a'), httpPort: 47960, discoveryPort: 47962);
    final b = TransferService(deviceId: 'bbb', deviceName: 'Komputer',
        saveDir: Directory('${tmp.path}/b'), httpPort: 47961, discoveryPort: 47962);
    await a.start();
    await b.start();
    try {
      for (var i = 0; i < 50 && (a.peers.isEmpty || b.peers.isEmpty); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      expect(a.peers['bbb']?.name, 'Komputer');
      expect(a.peers['bbb']?.port, 47961);
      expect(b.peers['aaa']?.name, 'Telefon');
    } finally {
      await a.dispose();
      await b.dispose();
      await tmp.delete(recursive: true);
    }
  });
}
