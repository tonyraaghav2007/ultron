import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FITNESS_FILE = path.join(DATA_DIR, 'fitness_memory.json');

export interface LiftRecord {
    exercise: string;
    weight: string | number;
    reps: number | string;
    date: string;
}

export interface BodyweightRecord {
    weight: string | number;
    date: string;
}

export interface FitnessData {
    lifts: LiftRecord[];
    bodyweight: BodyweightRecord[];
    lastWorkoutPromptTime?: string;
}

function getMemory(): FitnessData {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(FITNESS_FILE)) {
        return { lifts: [], bodyweight: [] };
    }
    try {
        const data = fs.readFileSync(FITNESS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { lifts: [], bodyweight: [] };
    }
}

function saveMemory(data: FitnessData) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(FITNESS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function logLift(exercise: string, weight: string | number, reps: number | string): string {
    const data = getMemory();
    const date = new Date().toISOString();
    data.lifts.push({ exercise, weight, reps, date });
    saveMemory(data);
    return `Successfully logged lift: ${exercise} - ${weight} for ${reps} reps on ${date}`;
}

export function logBodyweight(weight: string | number): string {
    const data = getMemory();
    const date = new Date().toISOString();
    data.bodyweight.push({ weight, date });
    saveMemory(data);
    return `Successfully logged bodyweight: ${weight} on ${date}`;
}

export function getFitnessHistory(): string {
    const data = getMemory();
    if (data.lifts.length === 0 && data.bodyweight.length === 0) {
        return "No fitness history found. The user has not logged any lifts or bodyweight yet.";
    }
    return JSON.stringify(data, null, 2);
}

export function hasBeenPromptedForWorkoutToday(): boolean {
    const data = getMemory();
    if (!data.lastWorkoutPromptTime) return false;

    const lastPrompt = new Date(data.lastWorkoutPromptTime);
    const now = new Date();
    
    // We want to check if the last prompt was after 6:00 AM of the *current logical day*.
    // The logical day starts at 6:00 AM today and ends at 6:00 AM tomorrow.
    
    // Create a boundary for 6:00 AM today
    const sixAMToday = new Date();
    sixAMToday.setHours(6, 0, 0, 0);

    // If it's currently before 6:00 AM (e.g. 2:00 AM), the logical boundary was actually 6:00 AM *yesterday*.
    if (now < sixAMToday) {
        sixAMToday.setDate(sixAMToday.getDate() - 1);
    }

    return lastPrompt >= sixAMToday;
}

export function markWorkoutPromptCompleted(): string {
    const data = getMemory();
    data.lastWorkoutPromptTime = new Date().toISOString();
    saveMemory(data);
    return "Workout prompt marked as completed for today.";
}
