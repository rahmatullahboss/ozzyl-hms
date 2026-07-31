import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/patient_notification.dart';
import '../../domain/repositories/notification_repository.dart';
import '../datasources/notification_remote_datasource.dart';

class NotificationRepositoryImpl implements NotificationRepository {
  final NotificationRemoteDatasource _remote;
  final ConnectivityService _connectivity;

  NotificationRepositoryImpl(this._remote, this._connectivity);

  @override
  Future<NotificationInboxPage> getNotifications({
    required int page,
    required bool unreadOnly,
  }) async {
    if (!await _connectivity.isOnline) {
      throw Exception('No internet connection. Please try again later.');
    }
    return _remote.getNotifications(page: page, unreadOnly: unreadOnly);
  }

  @override
  Future<void> markRead(int id) async {
    if (!await _connectivity.isOnline) {
      throw Exception('No internet connection. Please try again later.');
    }
    await _remote.markRead(id);
  }
}
