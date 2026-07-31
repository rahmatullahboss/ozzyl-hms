import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/di/injection.dart';
import '../../data/emergency_profile_storage.dart';

class EmergencyPage extends StatefulWidget {
  const EmergencyPage({super.key});

  @override
  State<EmergencyPage> createState() => _EmergencyPageState();
}

class _EmergencyPageState extends State<EmergencyPage> {
  String _bloodType = 'Unknown';
  List<String> _allergies = [];
  List<EmergencyContact> _contacts = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final profile = await EmergencyProfileStorage(sl()).read();
    setState(() {
      _bloodType = profile.bloodType;
      _allergies = profile.allergies;
      _contacts = profile.contacts;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Emergency')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SizedBox(
            height: 120,
            child: ElevatedButton(
              onPressed: _callEmergency,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.error,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
              child: const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.emergency, size: 40, color: Colors.white),
                  SizedBox(height: 8),
                  Text(
                    'SOS — Call Emergency',
                    style: TextStyle(
                      fontSize: 18,
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          Text('Allergy Card', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.bloodtype, color: AppColors.error),
                      const SizedBox(width: 8),
                      Text(
                        'Blood Type: $_bloodType',
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 16,
                        ),
                      ),
                      const Spacer(),
                      IconButton(
                        icon: const Icon(Icons.edit, size: 20),
                        onPressed: _editBloodType,
                      ),
                    ],
                  ),
                  const Divider(),
                  const Text(
                    'Allergies:',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  if (_allergies.isEmpty)
                    const Text(
                      'None recorded',
                      style: TextStyle(color: AppColors.textSecondary),
                    )
                  else
                    Wrap(
                      spacing: 8,
                      children:
                          _allergies.map((a) => Chip(label: Text(a))).toList(),
                    ),
                  TextButton(
                    onPressed: _editAllergies,
                    child: const Text('Edit Allergies'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Emergency Contacts',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              IconButton(icon: const Icon(Icons.add), onPressed: _addContact),
            ],
          ),
          const SizedBox(height: 8),
          if (_contacts.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    const Icon(Icons.contacts,
                        size: 48, color: AppColors.textSecondary),
                    const SizedBox(height: 8),
                    const Text('No emergency contacts'),
                    TextButton(
                      onPressed: _addContact,
                      child: const Text('Add Contact'),
                    ),
                  ],
                ),
              ),
            )
          else
            ..._contacts.map(
              (c) => Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.person)),
                  title: Text(c.name),
                  subtitle: Text(c.phone),
                  trailing: IconButton(
                    icon: const Icon(Icons.call, color: AppColors.success),
                    onPressed: () => launchUrl(Uri.parse('tel:${c.phone}')),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _callEmergency() async {
    if (_contacts.isNotEmpty) {
      await launchUrl(Uri.parse('tel:${_contacts.first.phone}'));
    } else {
      await launchUrl(Uri.parse('tel:999'));
    }
  }

  void _editBloodType() {
    final types = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    showDialog(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Blood Type'),
        children: types
            .map(
              (t) => SimpleDialogOption(
                onPressed: () async {
                  await EmergencyProfileStorage(sl()).saveBloodType(t);
                  setState(() => _bloodType = t);
                  if (ctx.mounted) Navigator.pop(ctx);
                },
                child: Text(t),
              ),
            )
            .toList(),
      ),
    );
  }

  void _editAllergies() {
    final ctrl = TextEditingController(text: _allergies.join(', '));
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Allergies'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(
            hintText: 'Comma-separated: Penicillin, Peanuts',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              final list = ctrl.text
                  .split(',')
                  .map((s) => s.trim())
                  .where((s) => s.isNotEmpty)
                  .toList();
              await EmergencyProfileStorage(sl()).saveAllergies(list);
              setState(() => _allergies = list);
              if (ctx.mounted) Navigator.pop(ctx);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  void _addContact() {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Emergency Contact'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameCtrl,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: phoneCtrl,
              decoration: const InputDecoration(labelText: 'Phone'),
              keyboardType: TextInputType.phone,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              if (nameCtrl.text.isNotEmpty && phoneCtrl.text.isNotEmpty) {
                _contacts.add(
                  EmergencyContact(
                    name: nameCtrl.text.trim(),
                    phone: phoneCtrl.text.trim(),
                  ),
                );
                await EmergencyProfileStorage(sl()).saveContacts(_contacts);
                setState(() {});
                if (ctx.mounted) Navigator.pop(ctx);
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }
}
