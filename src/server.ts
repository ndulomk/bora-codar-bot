import Fastify, { FastifyInstance } from 'fastify';
import { TwitterApi } from 'twitter-api-v2';
import cron from 'node-cron';
import { EventEmitter } from 'events';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import 'dotenv/config';


// Interfaces
interface ScheduledPost {
  id: string;
  content: string;
  scheduledFor: Date;
  status: 'pending' | 'posted' | 'failed';
  createdAt: Date;
  platform: 'twitter' | 'linkedin' | 'instagram';
  tags?: string[];
  retry_count?: number;
  publishedAt?: Date;
  errorMessage?: string;
}

interface PostRequest {
  content: string;
  scheduledFor?: string; 
  platform: 'twitter' | 'linkedin' | 'instagram';
  tags?: string[];
}



class PostScheduler extends EventEmitter {
  private db: Database | null = null;
  private twitterClient: TwitterApi;

  constructor() {
    super();
    
    this.twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY!,
      appSecret: process.env.TWITTER_API_SECRET!,
      accessToken: process.env.TWITTER_ACCESS_TOKEN!,
      accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
    });

    this.initDatabase();
    this.setupEventListeners();
    this.startScheduler();
  }

  private async initDatabase() {
    try {
      const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/posts.db');
      
      // Garantir que o diretório existe
      const dbDir = path.dirname(dbPath);
      const fs = require('fs');
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });

      // Criar tabelas
      await this.createTables();
      console.log('Database SQLite inicializado com sucesso');
    } catch (error) {
      console.error('Erro ao inicializar database:', error);
      throw error;
    }
  }

  private async createTables() {
    if (!this.db) throw new Error('Database não inicializado');

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        scheduled_for DATETIME NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        platform TEXT NOT NULL,
        tags TEXT,
        published_at DATETIME,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
      CREATE INDEX IF NOT EXISTS idx_posts_scheduled_for ON posts(scheduled_for);
      CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);

      CREATE TABLE IF NOT EXISTS post_analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts (id)
      );
    `);
  }

  private setupEventListeners() {
    this.on('post:scheduled', (post: ScheduledPost) => {
      console.log(`Post agendado para ${post.scheduledFor}: ${post.content.slice(0, 50)}...`);
      this.logAnalytics(post.id, 'scheduled', { scheduledFor: post.scheduledFor });
    });

    this.on('post:published', (post: ScheduledPost) => {
      console.log(`Post publicado com sucesso: ${post.id}`);
      this.updatePostStatus(post.id, 'posted', null, new Date().toISOString());
      this.logAnalytics(post.id, 'published');
    });

    this.on('post:failed', (post: ScheduledPost, error: any) => {
      console.error(`Falha ao publicar post ${post.id}:`, error);
      this.handleFailedPost(post.id, error.message || 'Erro desconhecido');
      this.logAnalytics(post.id, 'failed', { error: error.message });
    });

    this.on('post:retrying', (post: ScheduledPost, attempt: number) => {
      console.log(`Tentativa ${attempt} para o post ${post.id}`);
      this.logAnalytics(post.id, 'retry', { attempt });
    });
  }

  private async logAnalytics(postId: string, eventType: string, eventData?: any) {
    if (!this.db) return;
    
    try {
      await this.db.run(
        'INSERT INTO post_analytics (post_id, event_type, event_data) VALUES (?, ?, ?)',
        [postId, eventType, eventData ? JSON.stringify(eventData) : null]
      );
    } catch (error) {
      console.error('Erro ao salvar analytics:', error);
    }
  }

  async schedulePost(postData: PostRequest): Promise<string> {
    if (!this.db) throw new Error('Database não inicializado');

    const postId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const scheduledPost: ScheduledPost = {
      id: postId,
      content: postData.content,
      scheduledFor: postData.scheduledFor ? new Date(postData.scheduledFor) : new Date(),
      status: 'pending',
      createdAt: new Date(),
      platform: postData.platform,
      tags: postData.tags
    };

    try {
      await this.db.run(`
        INSERT INTO posts (id, content, scheduled_for, status, created_at, platform, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        postId,
        postData.content,
        scheduledPost.scheduledFor.toISOString(),
        'pending',
        scheduledPost.createdAt.toISOString(),
        postData.platform,
        postData.tags ? JSON.stringify(postData.tags) : null
      ]);

      this.emit('post:scheduled', scheduledPost);
      return postId;
    } catch (error) {
      console.error('Erro ao salvar post no database:', error);
      throw error;
    }
  }

  private async publishPost(post: ScheduledPost) {
    try {
      switch (post.platform) {
        case 'twitter':
          await this.publishToTwitter(post);
          break;
        case 'linkedin':
          console.log('LinkedIn publishing não implementado ainda');
          break;
        case 'instagram':
          console.log('Instagram publishing não implementado ainda');
          break;
      }
      
      this.emit('post:published', post);
    } catch (error) {
      const currentPost = await this.getPostById(post.id);
      if (currentPost && (currentPost.retry_count ?? 0) < 3) {
        this.emit('post:retrying', post, (currentPost.retry_count ?? 0) + 1);
        setTimeout(() => this.publishPost(post), 5 * 60 * 1000);
      } else {
        this.emit('post:failed', post, error);
      }
    }
  }

  private async publishToTwitter(post: ScheduledPost) {
    const tweet = await this.twitterClient.v2.tweet(post.content);
    return tweet;
  }

  private async updatePostStatus(
    postId: string, 
    status: ScheduledPost['status'], 
    errorMessage?: string | null,
    publishedAt?: string | null
  ) {
    if (!this.db) return;

    try {
      const updateFields = ['status = ?'];
      const updateValues: any[] = [status];

      if (errorMessage !== undefined) {
        updateFields.push('error_message = ?');
        updateValues.push(errorMessage);
      }

      if (publishedAt !== undefined) {
        updateFields.push('published_at = ?');
        updateValues.push(publishedAt);
      }

      if (status === 'failed') {
        updateFields.push('retry_count = retry_count + 1');
      }

      updateValues.push(postId);

      await this.db.run(
        `UPDATE posts SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    } catch (error) {
      console.error('Erro ao atualizar status do post:', error);
    }
  }

  private async handleFailedPost(postId: string, errorMessage: string) {
    await this.updatePostStatus(postId, 'failed', errorMessage);
  }

  private startScheduler() {
    // Verificar posts agendados a cada minuto
    cron.schedule('* * * * *', async () => {
      if (!this.db) return;

      try {
        const now = new Date().toISOString();
        
        // Buscar posts pendentes que devem ser publicados
        const posts = await this.db.all(`
          SELECT * FROM posts 
          WHERE status = 'pending' 
          AND scheduled_for <= ? 
          AND retry_count < 3
          ORDER BY scheduled_for ASC
        `, [now]);

        for (const dbPost of posts) {
          const post: ScheduledPost = {
            id: dbPost.id,
            content: dbPost.content,
            scheduledFor: new Date(dbPost.scheduled_for),
            status: dbPost.status as ScheduledPost['status'],
            createdAt: new Date(dbPost.created_at),
            platform: dbPost.platform as ScheduledPost['platform'],
            tags: dbPost.tags ? JSON.parse(dbPost.tags) : undefined,
            retry_count: dbPost.retry_count
          };

          console.log(`Publicando post agendado: ${post.id}`);
          this.publishPost(post);
        }
      } catch (error) {
        console.error('Erro no scheduler:', error);
      }
    });

    // Limpeza de posts antigos (executar diariamente à 1h)
    cron.schedule('0 1 * * *', async () => {
      await this.cleanupOldPosts();
    });

    cron.schedule('0 6 * * *', async () => {
      try {
        await this.schedulePost({
          content: 'bora codar?',
          platform: 'twitter',
          scheduledFor: new Date().toISOString(),
          tags: ['daily']
        });
        console.log('[CRON] Post diário "bora codar?"');
      } catch (error) {
        console.error('Erro ao agendar post diário:', error);
      }
    });
  }

  private async cleanupOldPosts() {
    if (!this.db) return;

    try {
      // Remover posts publicados há mais de 30 dias
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await this.db.run(`
        DELETE FROM posts 
        WHERE status IN ('posted', 'failed') 
        AND created_at < ?
      `, [thirtyDaysAgo.toISOString()]);

      console.log(`Limpeza: ${result.changes} posts antigos removidos`);
    } catch (error) {
      console.error('Erro na limpeza:', error);
    }
  }

  async getScheduledPosts(): Promise<ScheduledPost[]> {
    if (!this.db) return [];

    try {
      const posts = await this.db.all(`
        SELECT * FROM posts 
        ORDER BY created_at DESC
      `);

      return posts.map(dbPost => ({
        id: dbPost.id,
        content: dbPost.content,
        scheduledFor: new Date(dbPost.scheduled_for),
        status: dbPost.status as ScheduledPost['status'],
        createdAt: new Date(dbPost.created_at),
        platform: dbPost.platform as ScheduledPost['platform'],
        tags: dbPost.tags ? JSON.parse(dbPost.tags) : undefined,
        retry_count: dbPost.retry_count,
        publishedAt: dbPost.published_at ? new Date(dbPost.published_at) : undefined,
        errorMessage: dbPost.error_message
      }));
    } catch (error) {
      console.error('Erro ao buscar posts:', error);
      return [];
    }
  }

  async getPostById(id: string): Promise<ScheduledPost | undefined> {
    if (!this.db) return undefined;

    try {
      const dbPost = await this.db.get('SELECT * FROM posts WHERE id = ?', [id]);
      
      if (!dbPost) return undefined;

      return {
        id: dbPost.id,
        content: dbPost.content,
        scheduledFor: new Date(dbPost.scheduled_for),
        status: dbPost.status as ScheduledPost['status'],
        createdAt: new Date(dbPost.created_at),
        platform: dbPost.platform as ScheduledPost['platform'],
        tags: dbPost.tags ? JSON.parse(dbPost.tags) : undefined,
        retry_count: dbPost.retry_count,
        publishedAt: dbPost.published_at ? new Date(dbPost.published_at) : undefined,
        errorMessage: dbPost.error_message
      };
    } catch (error) {
      console.error('Erro ao buscar post:', error);
      return undefined;
    }
  }

  async deleteScheduledPost(id: string): Promise<boolean> {
    if (!this.db) return false;

    try {
      const result = await this.db.run('DELETE FROM posts WHERE id = ? AND status = "pending"', [id]);
      return (result.changes || 0) > 0;
    } catch (error) {
      console.error('Erro ao deletar post:', error);
      return false;
    }
  }

  async getAnalytics(postId?: string) {
    if (!this.db) return { posts: 0, analytics: [] };

    try {
      let query = `
        SELECT 
          pa.*,
          p.content,
          p.platform,
          p.status
        FROM post_analytics pa
        JOIN posts p ON pa.post_id = p.id
      `;
      let params: any[] = [];

      if (postId) {
        query += ' WHERE pa.post_id = ?';
        params.push(postId);
      }

      query += ' ORDER BY pa.created_at DESC LIMIT 100';

      const analytics = await this.db.all(query, params);

      // Estatísticas gerais
      const stats = await this.db.get(`
        SELECT 
          COUNT(*) as total_posts,
          SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as published,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM posts
      `);

      return {
        stats,
        analytics: analytics.map(a => ({
          ...a,
          event_data: a.event_data ? JSON.parse(a.event_data) : null
        }))
      };
    } catch (error) {
      console.error('Erro ao buscar analytics:', error);
      return { posts: 0, analytics: [] };
    }
  }
}


// Conteúdos pré-definidos
const PREDEFINED_CONTENTS = {
 
};

// Inicializar servidor
const buildServer = (): FastifyInstance => {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty'
      }
    }
  });

  const scheduler = new PostScheduler();

  fastify.register(require('@fastify/cors'), {
    origin: true
  });

  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Postar imediatamente
  fastify.post<{ Body: PostRequest }>('/api/posts/publish', async (request, reply) => {
    try {
      const postId = scheduler.schedulePost({
        ...request.body,
        scheduledFor: new Date().toISOString() 
      });

      return {
        success: true,
        message: 'Post publicado com sucesso',
        scheduledId: postId
      };
    } catch (error) {
      reply.status(500);
      return {
        success: false,
        message: 'Erro ao publicar post',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      };
    }
  });

  // Agendar post
  fastify.post<{ Body: PostRequest }>('/api/posts/schedule', async (request, reply) => {
    try {
      if (!request.body.scheduledFor) {
        reply.status(400);
        return {
          success: false,
          message: 'scheduledFor é obrigatório para agendamento'
        };
      }

      const postId = scheduler.schedulePost(request.body);

      return {
        success: true,
        message: 'Post agendado com sucesso',
        scheduledId: postId
      };
    } catch (error) {
      reply.status(500);
      return {
        success: false,
        message: 'Erro ao agendar post',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      };
    }
  });

  // Listar posts agendados
  fastify.get('/api/posts/scheduled', async (request, reply) => {
    const posts = scheduler.getScheduledPosts();
    return {
      success: true,
      posts: (await posts).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    };
  });

  // Buscar post específico
  fastify.get<{ Params: { id: string } }>('/api/posts/:id', async (request, reply) => {
    const post = scheduler.getPostById(request.params.id);
    
    if (!post) {
      reply.status(404);
      return {
        success: false,
        message: 'Post não encontrado'
      };
    }

    return {
      success: true,
      post
    };
  });

  // Deletar post agendado
  fastify.delete<{ Params: { id: string } }>('/api/posts/:id', async (request, reply) => {
    const deleted = scheduler.deleteScheduledPost(request.params.id);
    
    if (!deleted) {
      reply.status(404);
      return {
        success: false,
        message: 'Post não encontrado'
      };
    }

    return {
      success: true,
      message: 'Post deletado com sucesso'
    };
  });

  // Conteúdos pré-definidos
  fastify.get('/api/content/predefined', async (request, reply) => {
    return {
      success: true,
      contents: PREDEFINED_CONTENTS
    };
  });

  // Postar conteúdo pré-definido
  fastify.post<{ 
    Body: { 
      category: keyof typeof PREDEFINED_CONTENTS,
      index: number,
      scheduledFor?: string,
      platform: 'twitter' | 'linkedin' | 'instagram',
    }
  }>('/api/content/predefined/publish', async (request, reply) => {
    try {
      const { category, index, scheduledFor, platform } = request.body;
      
      if (!PREDEFINED_CONTENTS[category] || !PREDEFINED_CONTENTS[category][index]) {
        reply.status(400);
        return {
          success: false,
          message: 'Conteúdo não encontrado'
        };
      }

      const content = PREDEFINED_CONTENTS[category][index];
      const postId = scheduler.schedulePost({
        content,
        scheduledFor: scheduledFor || new Date().toISOString(),
        platform,
        tags: [category]
      });

      return {
        success: true,
        message: scheduledFor ? 'Conteúdo agendado com sucesso' : 'Conteúdo publicado com sucesso',
        scheduledId: postId,
        content
      };
    } catch (error) {
      reply.status(500);
      return {
        success: false,
        message: 'Erro ao processar conteúdo',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      };
    }
  });

  // Analytics endpoint
  fastify.get('/api/analytics', async (request, reply) => {
    try {
      const analytics = await scheduler.getAnalytics();
      return {
        success: true,
        ...analytics
      };
    } catch (error) {
      reply.status(500);
      return {
        success: false,
        message: 'Erro ao buscar analytics',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      };
    }
  });

  // Analytics por post
  fastify.get<{ Params: { id: string } }>('/api/analytics/:id', async (request, reply) => {
    try {
      const analytics = await scheduler.getAnalytics(request.params.id);
      return {
        success: true,
        ...analytics
      };
    } catch (error) {
      reply.status(500);
      return {
        success: false,
        message: 'Erro ao buscar analytics do post',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      };
    }
  });

  return fastify;
};

// Função principal
const start = async () => {
  try {
    const server = buildServer();
    
    await server.listen({
      port: parseInt(process.env.PORT || '3000'),
      host: '0.0.0.0'
    });
    
  } catch (err) {
    console.error('Erro ao iniciar servidor:', err);
    process.exit(1);
  }
};

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Iniciar aplicação se executado diretamente
if (require.main === module) {
  start();
}

export { buildServer, PostScheduler };