import { startCloudRelay } from './lib/cloudRelay';
import { sendScreenshotToPhone } from './lib/cloudRelay';

console.log("Starting JARVIS Cloud Relay...");
startCloudRelay();

// Keep the process alive
setInterval(() => {
    // heartbeat
}, 10000);
