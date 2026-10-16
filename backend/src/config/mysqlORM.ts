import { Sequelize, DataTypes } from 'sequelize';
import type { Model, ModelStatic } from 'sequelize';
import defineContact from '../models/Contact.js';
import defineTicket from '../models/Ticket.js';
import { definePrimaryDepartment, defineChatsDepartment } from '../models/Department.js';
import defineDepartmentEmail from '../models/DepartmentEmail.js';
import defineChat from '../models/Chat.js';

const instances: Record<string, Sequelize> = {};

/**
 * Get a named Sequelize instance for MySQL.
 * @param {string} name - 'primary' (MYSQL_*) or 'chats' (MYSQL2_*)
 */
export function getSequelizeInstance(name: string = 'primary'): Sequelize {
  if (!instances[name]) {
    const config = name === 'chats'
      ? {
          host: process.env.MYSQL2_HOST,
          port: parseInt(process.env.MYSQL2_PORT || '3306'),
          username: process.env.MYSQL2_USER,
          password: process.env.MYSQL2_PASS,
          database: process.env.MYSQL2_DB,
        }
      : {
          host: process.env.MYSQL_HOST,
          port: parseInt(process.env.MYSQL_PORT || '3306'),
          username: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASS,
          database: process.env.MYSQL_DB,
        };

    instances[name] = new Sequelize(config.database as string, config.username as string, config.password, {
      host: config.host,
      port: config.port,
      dialect: 'mysql',
      logging: false,
      pool: {
        max: 5,
        min: 0,
        acquire: 10000,
        idle: 10000,
      },
    });
  }
  return instances[name];
}

// ── Model Registry ───────────────────────────────────────

type MySQLModel = ModelStatic<Model>;

export interface MySQLModels {
  Contact?: MySQLModel;
  Ticket?: MySQLModel;
  Department?: MySQLModel;
  DepartmentEmail?: MySQLModel;
  Chat?: MySQLModel;
}

const models: Record<string, MySQLModels> = {};

function defineModels(sequelize: Sequelize, name: string): MySQLModels {
  if (models[name]) return models[name];

  const m: MySQLModels = {};

  if (name === 'primary') {
    m.Contact = defineContact(sequelize);
    m.Ticket = defineTicket(sequelize);
    m.Department = definePrimaryDepartment(sequelize);
    m.DepartmentEmail = defineDepartmentEmail(sequelize);
  }

  if (name === 'chats') {
    m.Chat = defineChat(sequelize);
    m.Department = defineChatsDepartment(sequelize);
  }

  models[name] = m;
  return m;
}

/**
 * Get Sequelize models for a named MySQL connection.
 * @param {string} name - 'primary' or 'chats'
 */
export function getMySQLModels(name: string = 'primary'): MySQLModels {
  const sequelize = getSequelizeInstance(name);
  return defineModels(sequelize, name);
}

export { DataTypes };
