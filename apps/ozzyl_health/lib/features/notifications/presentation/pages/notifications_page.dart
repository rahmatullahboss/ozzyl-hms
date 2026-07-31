import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/notification_remote_datasource.dart';
import '../../data/repositories/notification_repository_impl.dart';
import '../../domain/entities/patient_notification.dart';
import '../../domain/repositories/notification_repository.dart';
import '../bloc/notification_bloc.dart';
import '../bloc/notification_event.dart';
import '../bloc/notification_state.dart';

String? notificationRouteForLink(String? rawLink) {
  final link = rawLink?.trim();
  if (link == null || link.isEmpty || !link.startsWith('/') || link.startsWith('//')) {
    return null;
  }
  final uri = Uri.tryParse(link);
  if (uri == null || uri.hasScheme || uri.hasAuthority) return null;
  if (uri.pathSegments.any((segment) => segment == '.' || segment == '..')) {
    return null;
  }
  const allowedRoutes = [
    '/lab-results',
    '/appointments',
    '/prescriptions',
    '/health-records',
    '/family',
  ];
  final path = uri.path;
  return allowedRoutes.any(
    (route) => path == route || path.startsWith('$route/'),
  )
      ? uri.toString()
      : null;
}

class NotificationsPage extends StatelessWidget {
  final NotificationRepository? repository;

  const NotificationsPage({super.key, this.repository});

  @override
  Widget build(BuildContext context) {
    final resolvedRepository = repository ??
        NotificationRepositoryImpl(
          NotificationRemoteDatasource(sl<ApiClient>()),
          sl<ConnectivityService>(),
        );

    return BlocProvider(
      create: (_) => NotificationBloc(resolvedRepository)
        ..add(const LoadNotifications()),
      child: const _NotificationsView(),
    );
  }
}

class _NotificationsView extends StatelessWidget {
  const _NotificationsView();

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<NotificationBloc, NotificationState>(
      listenWhen: (previous, current) =>
          previous.markReadError != current.markReadError &&
          current.markReadError != null,
      listener: (context, state) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(state.markReadError!)),
        );
      },
      builder: (context, state) {
        return Scaffold(
          appBar: AppBar(
            title: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Notifications'),
                if (state.unreadCount > 0) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.error,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      state.unreadCount > 99 ? '99+' : '${state.unreadCount}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          body: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: Row(
                  children: [
                    ChoiceChip(
                      label: const Text('All'),
                      selected: !state.unreadOnly,
                      onSelected: (_) => context.read<NotificationBloc>().add(
                            const LoadNotifications(unreadOnly: false),
                          ),
                    ),
                    const SizedBox(width: 8),
                    ChoiceChip(
                      label: const Text('Unread'),
                      selected: state.unreadOnly,
                      onSelected: (_) => context.read<NotificationBloc>().add(
                            const LoadNotifications(unreadOnly: true),
                          ),
                    ),
                    const Spacer(),
                    IconButton(
                      tooltip: 'Refresh notifications',
                      onPressed: state.status == NotificationStatus.loading
                          ? null
                          : () => context.read<NotificationBloc>().add(
                                LoadNotifications(
                                  unreadOnly: state.unreadOnly,
                                ),
                              ),
                      icon: const Icon(Icons.refresh_rounded),
                    ),
                  ],
                ),
              ),
              Expanded(child: _NotificationBody(state: state)),
            ],
          ),
        );
      },
    );
  }
}

class _NotificationBody extends StatelessWidget {
  final NotificationState state;

  const _NotificationBody({required this.state});

  @override
  Widget build(BuildContext context) {
    if (state.status == NotificationStatus.loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.status == NotificationStatus.error) {
      return _NotificationError(
        message: state.errorMessage ?? 'Unable to load notifications.',
        onRetry: () => context.read<NotificationBloc>().add(
              LoadNotifications(unreadOnly: state.unreadOnly),
            ),
      );
    }
    if (state.notifications.isEmpty) {
      return RefreshIndicator(
        onRefresh: () async {
          context.read<NotificationBloc>().add(
                LoadNotifications(unreadOnly: state.unreadOnly),
              );
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: MediaQuery.sizeOf(context).height * 0.18),
            Icon(
              state.unreadOnly
                  ? Icons.mark_email_read_outlined
                  : Icons.notifications_none_rounded,
              size: 72,
              color: AppColors.textSecondary,
            ),
            const SizedBox(height: 18),
            Text(
              state.unreadOnly
                  ? 'No unread notifications'
                  : 'No notifications yet',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                'Important appointment, laboratory, and health updates will appear here.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textSecondary),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () async {
        context.read<NotificationBloc>().add(
              LoadNotifications(unreadOnly: state.unreadOnly),
            );
      },
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        itemCount: state.notifications.length + 1,
        itemBuilder: (context, index) {
          if (index == state.notifications.length) {
            return _LoadMoreFooter(state: state);
          }
          return _NotificationCard(notification: state.notifications[index]);
        },
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  final PatientNotification notification;

  const _NotificationCard({required this.notification});

  @override
  Widget build(BuildContext context) {
    final route = notificationRouteForLink(notification.link);
    final isMarking = context.select<NotificationBloc, bool>(
      (bloc) => bloc.state.markingReadId == notification.id,
    );
    final warningColor = notification.isRetraction
        ? AppColors.error
        : AppColors.primary;
    final time = DateFormat('MMM d, yyyy · h:mm a')
        .format(notification.createdAt.toLocal());

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: notification.isRead
          ? null
          : warningColor.withValues(alpha: 0.05),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: isMarking
            ? null
            : () {
                if (!notification.isRead) {
                  context.read<NotificationBloc>().add(
                        MarkNotificationRead(notification.id),
                      );
                }
                if (route != null) context.push(route);
              },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: warningColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(
                  notification.isRetraction
                      ? Icons.warning_amber_rounded
                      : Icons.notifications_outlined,
                  color: warningColor,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            notification.title,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: notification.isRead
                                  ? FontWeight.w600
                                  : FontWeight.w700,
                            ),
                          ),
                        ),
                        if (!notification.isRead)
                          Container(
                            key: ValueKey('notification-unread-${notification.id}'),
                            width: 9,
                            height: 9,
                            margin: const EdgeInsets.only(top: 4, left: 8),
                            decoration: BoxDecoration(
                              color: warningColor,
                              shape: BoxShape.circle,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      notification.message,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        height: 1.4,
                      ),
                    ),
                    if (notification.isRetraction) ...[
                      const SizedBox(height: 8),
                      const Text(
                        'Do not use the withdrawn report. Open Lab Results for the approved correction.',
                        style: TextStyle(
                          color: AppColors.error,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Text(
                          time,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                        const Spacer(),
                        if (isMarking)
                          const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        else if (route != null)
                          const Icon(
                            Icons.chevron_right_rounded,
                            color: AppColors.textSecondary,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LoadMoreFooter extends StatelessWidget {
  final NotificationState state;

  const _LoadMoreFooter({required this.state});

  @override
  Widget build(BuildContext context) {
    if (state.loadMoreError != null) {
      return Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Column(
          children: [
            Text(
              state.loadMoreError!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.error, fontSize: 12),
            ),
            TextButton.icon(
              onPressed: () => context
                  .read<NotificationBloc>()
                  .add(const LoadMoreNotifications()),
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry loading more'),
            ),
          ],
        ),
      );
    }
    if (!state.hasMore) return const SizedBox(height: 8);
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Center(
        child: state.isLoadingMore
            ? const Padding(
                padding: EdgeInsets.all(12),
                child: CircularProgressIndicator(),
              )
            : TextButton(
                onPressed: () => context
                    .read<NotificationBloc>()
                    .add(const LoadMoreNotifications()),
                child: const Text('Load more'),
              ),
      ),
    );
  }
}

class _NotificationError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _NotificationError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_rounded, size: 56, color: AppColors.error),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
