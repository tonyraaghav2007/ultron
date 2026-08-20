import { NextResponse } from 'next/server';
import { startCloudRelay } from '../../../lib/cloudRelay';

export async function GET() {
  try {
    startCloudRelay();
    return NextResponse.json({ status: 'success', message: 'Cloud Relay started or already running.' });
  } catch (error) {
    return NextResponse.json({ status: 'error', message: 'Failed to start Cloud Relay.' }, { status: 500 });
  }
}
