declare module 'html5-qrcode' {
  interface Html5QrcodeConfig {
    fps?: number;
    qrbox?: { width: number; height: number } | number;
    aspectRatio?: number;
    disableFlip?: boolean;
    verbose?: boolean;
  }

  interface CameraDevice {
    id: string;
    label: string;
  }

  type SuccessCallback = (decodedText: string, result: unknown) => void;
  type ErrorCallback = (errorMessage: string) => void;

  export class Html5Qrcode {
    constructor(elementId: string, config?: { verbose?: boolean; useBarCodeDetectorIfSupported?: boolean });
    start(
      cameraConfig: string | { facingMode: string } | CameraDevice,
      configuration: Html5QrcodeConfig,
      successCallback: SuccessCallback,
      errorCallback: ErrorCallback,
    ): Promise<void>;
    stop(): Promise<void>;
    clear(): void;
    getCameras(): Promise<CameraDevice[]>;
    isScanning: boolean;
  }

  export class Html5QrcodeScanner {
    constructor(
      elementId: string,
      config: Html5QrcodeConfig,
      verbose?: boolean,
    );
    render(successCallback: SuccessCallback, errorCallback: ErrorCallback): void;
    clear(): Promise<void>;
  }

  export class Html5QrcodeSupportedFormats {
    static QR_CODE: string;
    static AZTEC: string;
    static CODABAR: string;
    static CODE_39: string;
    static CODE_93: string;
    static CODE_128: string;
    static DATA_MATRIX: string;
    static MAXICODE: string;
    static ITF: string;
    static EAN_13: string;
    static EAN_8: string;
    static PDF_417: string;
    static RSS_14: string;
    static RSS_EXPANDED: string;
    static UPC_A: string;
    static UPC_E: string;
  }
}
