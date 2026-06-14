import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(
    username: string,
    email: string,
    passwordHash: string,
    isEmailVerified = false,
  ): Promise<User> {
    const normalizedUsername = this.normalizeUsername(username);
    const normalizedEmail = this.normalizeEmail(email);
    const existingEmail = await this.findByEmail(normalizedEmail);

    if (existingEmail) {
      throw new ConflictException('Email is already registered');
    }

    const existingUsername = await this.findByUsername(normalizedUsername);

    if (existingUsername) {
      throw new ConflictException('Username is already registered');
    }

    const user = this.usersRepository.create({
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
      isEmailVerified,
    });

    return this.usersRepository.save(user);
  }

  createVerified(
    username: string,
    email: string,
    passwordHash: string,
  ): Promise<User> {
    return this.create(username, email, passwordHash, true);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email: this.normalizeEmail(email) },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { username: this.normalizeUsername(username) },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
    });
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    const normalizedIdentifier = identifier.trim();

    if (normalizedIdentifier.includes('@')) {
      return this.findByEmail(normalizedIdentifier);
    }

    return this.findByUsername(normalizedIdentifier);
  }

  async markEmailVerified(email: string): Promise<User> {
    const user = await this.findByEmail(email);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isEmailVerified) {
      return user;
    }

    user.isEmailVerified = true;
    return this.usersRepository.save(user);
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }
}
