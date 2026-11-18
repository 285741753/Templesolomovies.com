/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDINARY_CLOUD_NAME?: string;
  readonly VITE_CLOUDINARY_UPLOAD_PRESET?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface BluetoothRemoteGATTCharacteristicLike {
  value?: DataView | null;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristicLike>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValue?(value: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTServiceLike {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristicLike>;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristicLike[]>;
}

interface BluetoothRemoteGATTServerLike {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServerLike>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTServiceLike>;
  getPrimaryServices(): Promise<BluetoothRemoteGATTServiceLike[]>;
}

interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServerLike;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface NavigatorBluetoothLike {
  requestDevice(options: {
    filters?: Array<{ services?: string[]; namePrefix?: string }>;
    acceptAllDevices?: boolean;
    optionalServices?: string[];
  }): Promise<BluetoothDeviceLike>;
}

interface Navigator {
  readonly bluetooth?: NavigatorBluetoothLike;
}
