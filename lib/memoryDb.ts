import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Define the database path
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'jarvis.db');

export interface MemoryRecord {
    id: number;
    content: string;
    category: string;
    tags: string; // Stored as comma-separated string for simplicity
    created_at: string;
}

export interface ResearchJob {
    id: string;
    topic: string;
    original_request: string;
    mode: string;
    status: string;
    research_plan: string;
    summary: string;
    source_count: number;
    primary_source_count: number;
    claim_count: number;
    contradiction_count: number;
    confidence: string;
    pdf_path: string;
    knowledge_version: number;
    started_at: string;
    completed_at: string;
    duration_seconds: number;
}

export interface ResearchClaim {
    id: number;
    research_id: string;
    claim: string;
    category: string;
    confidence: string;
    supported_by: string;
    contradicted_by: string;
    resolution: string;
    tags: string;
}

export interface ResearchSource {
    id: number;
    research_id: string;
    url: string;
    title: string;
    author: string;
    publisher: string;
    source_type: string;
    authority: string;
    relevance: string;
    is_primary: number;
    retrieved_at: string;
    excerpt: string;
}

let db: Database.Database | null = null;

// Initialize the database connection and schema
export function initDb(): Database.Database {
    if (db) return db;

    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    db = new Database(DB_FILE);

    // Create the memories table if it doesn't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            tags TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Research jobs table — tracks full lifecycle of each research project
    db.exec(`
        CREATE TABLE IF NOT EXISTS research_jobs (
            id TEXT PRIMARY KEY,
            topic TEXT NOT NULL,
            original_request TEXT,
            mode TEXT DEFAULT 'standard',
            status TEXT DEFAULT 'pending',
            research_plan TEXT,
            summary TEXT,
            source_count INTEGER DEFAULT 0,
            primary_source_count INTEGER DEFAULT 0,
            claim_count INTEGER DEFAULT 0,
            contradiction_count INTEGER DEFAULT 0,
            confidence TEXT DEFAULT 'medium',
            pdf_path TEXT,
            knowledge_version INTEGER DEFAULT 1,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            duration_seconds INTEGER
        )
    `);

    // Extracted claims with source cross-references
    db.exec(`
        CREATE TABLE IF NOT EXISTS research_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            research_id TEXT NOT NULL,
            claim TEXT NOT NULL,
            category TEXT,
            confidence TEXT DEFAULT 'medium',
            supported_by TEXT,
            contradicted_by TEXT,
            resolution TEXT,
            tags TEXT DEFAULT '',
            FOREIGN KEY (research_id) REFERENCES research_jobs(id)
        )
    `);

    // Sources with evaluation metadata
    db.exec(`
        CREATE TABLE IF NOT EXISTS research_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            research_id TEXT NOT NULL,
            url TEXT NOT NULL,
            title TEXT,
            author TEXT,
            publisher TEXT,
            source_type TEXT,
            authority TEXT DEFAULT 'medium',
            relevance TEXT DEFAULT 'medium',
            is_primary INTEGER DEFAULT 0,
            retrieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            excerpt TEXT,
            FOREIGN KEY (research_id) REFERENCES research_jobs(id)
        )
    `);

    return db;
}

// ===================== CORE MEMORIES =====================

// Add a new memory
export function addMemory(content: string, category: string = 'general', tags: string[] = []): number {
    const database = initDb();
    const stmt = database.prepare('INSERT INTO memories (content, category, tags) VALUES (?, ?, ?)');
    
    const tagsString = tags.join(',');
    const info = stmt.run(content, category, tagsString);
    
    return info.lastInsertRowid as number;
}

// Get all memories
export function getAllMemories(): MemoryRecord[] {
    const database = initDb();
    const stmt = database.prepare('SELECT * FROM memories ORDER BY created_at DESC');
    return stmt.all() as MemoryRecord[];
}

// Basic search memories by text
export function searchMemories(query: string): MemoryRecord[] {
    const database = initDb();
    // A simple LIKE search (case-insensitive in SQLite)
    const stmt = database.prepare('SELECT * FROM memories WHERE content LIKE ? OR tags LIKE ? ORDER BY created_at DESC');
    const searchString = `%${query}%`;
    return stmt.all(searchString, searchString) as MemoryRecord[];
}

// Delete a memory
export function deleteMemory(id: number): boolean {
    const database = initDb();
    const stmt = database.prepare('DELETE FROM memories WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
}

// ===================== RESEARCH JOBS =====================

export function createResearchJob(id: string, topic: string, mode: string = 'standard', originalRequest?: string): void {
    const database = initDb();
    // Check if same topic was researched before to set version
    const existing = database.prepare('SELECT MAX(knowledge_version) as max_v FROM research_jobs WHERE topic = ?').get(topic) as any;
    const version = (existing?.max_v || 0) + 1;
    
    const stmt = database.prepare(`
        INSERT INTO research_jobs (id, topic, original_request, mode, status, knowledge_version)
        VALUES (?, ?, ?, ?, 'planning', ?)
    `);
    stmt.run(id, topic, originalRequest || topic, mode, version);
}

export function updateResearchJob(id: string, updates: Partial<ResearchJob>): void {
    const database = initDb();
    const fields: string[] = [];
    const values: any[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
        if (key !== 'id') {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }
    
    if (fields.length === 0) return;
    values.push(id);
    database.prepare(`UPDATE research_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getResearchJob(id: string): ResearchJob | undefined {
    const database = initDb();
    return database.prepare('SELECT * FROM research_jobs WHERE id = ?').get(id) as ResearchJob | undefined;
}

export function getAllResearchJobs(): ResearchJob[] {
    const database = initDb();
    return database.prepare('SELECT * FROM research_jobs ORDER BY started_at DESC').all() as ResearchJob[];
}

// ===================== RESEARCH CLAIMS =====================

export function addResearchClaim(
    researchId: string, claim: string, category: string = 'fact',
    confidence: string = 'medium', supportedBy: string[] = [], contradictedBy: string[] = [],
    resolution?: string, tags: string[] = []
): number {
    const database = initDb();
    const stmt = database.prepare(`
        INSERT INTO research_claims (research_id, claim, category, confidence, supported_by, contradicted_by, resolution, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
        researchId, claim, category, confidence,
        JSON.stringify(supportedBy), JSON.stringify(contradictedBy),
        resolution || '', tags.join(',')
    );
    return info.lastInsertRowid as number;
}

export function getResearchClaims(researchId: string): ResearchClaim[] {
    const database = initDb();
    return database.prepare('SELECT * FROM research_claims WHERE research_id = ? ORDER BY id').all(researchId) as ResearchClaim[];
}

// ===================== RESEARCH SOURCES =====================

export function addResearchSource(
    researchId: string, url: string, title: string = '',
    sourceType: string = 'unknown', authority: string = 'medium',
    isPrimary: boolean = false, excerpt: string = '',
    author?: string, publisher?: string
): number {
    const database = initDb();
    const stmt = database.prepare(`
        INSERT INTO research_sources (research_id, url, title, source_type, authority, is_primary, excerpt, author, publisher)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(researchId, url, title, sourceType, authority, isPrimary ? 1 : 0, excerpt, author || '', publisher || '');
    return info.lastInsertRowid as number;
}

export function getResearchSources(researchId: string): ResearchSource[] {
    const database = initDb();
    return database.prepare('SELECT * FROM research_sources WHERE research_id = ? ORDER BY authority DESC, is_primary DESC').all(researchId) as ResearchSource[];
}

// ===================== KNOWLEDGE SEARCH =====================

export function searchKnowledge(query: string): { jobs: ResearchJob[], claims: ResearchClaim[] } {
    const database = initDb();
    const searchString = `%${query}%`;
    
    // Search research jobs by topic and summary
    const jobs = database.prepare(`
        SELECT * FROM research_jobs 
        WHERE (topic LIKE ? OR summary LIKE ? OR original_request LIKE ?) 
        AND status = 'completed'
        ORDER BY started_at DESC
    `).all(searchString, searchString, searchString) as ResearchJob[];
    
    // Search claims by content and tags
    const claims = database.prepare(`
        SELECT c.*, j.topic FROM research_claims c
        JOIN research_jobs j ON c.research_id = j.id
        WHERE (c.claim LIKE ? OR c.tags LIKE ? OR c.category LIKE ?)
        AND j.status = 'completed'
        ORDER BY 
            CASE c.confidence 
                WHEN 'high' THEN 1 
                WHEN 'medium' THEN 2 
                WHEN 'low' THEN 3 
                ELSE 4 
            END
    `).all(searchString, searchString, searchString) as ResearchClaim[];
    
    return { jobs, claims };
}
