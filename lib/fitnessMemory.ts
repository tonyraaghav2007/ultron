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
    hasBeenInitialPrompted?: boolean;
}

function getMemory(): FitnessData {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(FITNESS_FILE)) {
        return { lifts: [], bodyweight: [], hasBeenInitialPrompted: false };
    }
    try {
        const data = fs.readFileSync(FITNESS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { lifts: [], bodyweight: [], hasBeenInitialPrompted: false };
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

export function hasBeenPromptedInitial(): boolean {
    const data = getMemory();
    if (data.hasBeenInitialPrompted) return true;
    // If the user already has logged lifts or bodyweight, they are definitely not a first-time user
    if ((data.lifts && data.lifts.length > 0) || (data.bodyweight && data.bodyweight.length > 0)) {
        data.hasBeenInitialPrompted = true;
        saveMemory(data);
        return true;
    }
    return false;
}

export function hasBeenPromptedForWorkoutToday(): boolean {
    // If already prompted initially, do not prompt on startup
    return hasBeenPromptedInitial();
}

export function markWorkoutPromptCompleted(): string {
    const data = getMemory();
    data.hasBeenInitialPrompted = true;
    data.lastWorkoutPromptTime = new Date().toISOString();
    saveMemory(data);
    return "Initial workout and diet prompt marked as completed.";
}

export function markInitialPromptCompleted(): string {
    return markWorkoutPromptCompleted();
}
