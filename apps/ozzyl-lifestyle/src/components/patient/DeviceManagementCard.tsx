import React, { useState } from 'react';
import { Watch, Smartphone, Bell, RefreshCw } from 'lucide-react';

export const DeviceManagementCard: React.FC = () => {
  const [pushEnabled, setPushEnabled] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = () => {
    setIsSyncing(true);
    setTimeout(() => setIsSyncing(false), 2000);
  };

  return (
    <div className="bg-surface-container-low rounded-xl shadow-sm border-none overflow-hidden font-inter p-5">
      <h2 className="font-manrope text-lg font-semibold text-on-surface mb-1">Devices & Settings</h2>
      <p className="text-sm text-on-surface-variant mb-5">Manage wearables and notifications</p>

      {/* Connected Wearable */}
      <div className="bg-surface p-4 rounded-xl shadow-sm border border-surface-container flex justify-between items-center mb-3">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 p-2.5 rounded-xl text-primary">
            <Watch className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm text-on-surface">Apple Watch Series 8</span>
            <span className="text-xs text-on-surface-variant">Last synced: 15 mins ago</span>
          </div>
        </div>
        <button 
          onClick={handleSync}
          className={`p-2 rounded-full flex items-center justify-center transition-all bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary`}
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Connected Phone */}
      <div className="bg-surface p-4 rounded-xl shadow-sm border border-surface-container flex justify-between items-center mb-5">
        <div className="flex items-center gap-3">
          <div className="bg-surface-container-high p-2.5 rounded-xl text-on-surface">
            <Smartphone className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm text-on-surface">iPhone 14 Pro</span>
            <span className="text-xs text-on-surface-variant">Active Mobile App</span>
          </div>
        </div>
      </div>

      <div className="h-px w-full bg-surface-container mb-5" />

      {/* Push Notifications Toggle */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${pushEnabled ? 'bg-[#FFDDAE] text-[#935200]' : 'bg-surface-container text-on-surface-variant'}`}>
            <Bell className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm text-on-surface">Push Notifications</span>
            <span className="text-xs text-on-surface-variant">Reminders & health alerts</span>
          </div>
        </div>
        
        {/* iOS style toggle */}
        <button 
          onClick={() => setPushEnabled(!pushEnabled)}
          className={`w-12 h-6 rounded-full relative transition-colors duration-300 ease-in-out border-none focus:outline-none ${pushEnabled ? 'bg-primary' : 'bg-surface-container-highest'}`}
        >
          <div className={`absolute top-1 left-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-transform duration-300 ease-in-out ${pushEnabled ? 'transform translate-x-6' : ''}`} />
        </button>
      </div>
    </div>
  );
};
