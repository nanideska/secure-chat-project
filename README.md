# Secure Chat Project

## Getting Started

### 1. Clone the Repository
```sh
git clone https://github.com/nanideska/secure-chat-project.git
cd secure-chat-project
```

### 2. Install Dependencies
After pulling the repository, install the necessary dependencies for each part of the project.

#### Install Server Dependencies
```sh
cd server
npm install
```

#### Install Web Client Dependencies
```sh
cd ../web-client
npm install
```

#### Install Mobile Client Dependencies
```sh
cd ../mobile-client
npm install
```

### 3. Start the Project

#### Start MongoDB (if not already running)
```sh
mongod
```

#### Start the Server
```sh
cd server
node index.js
```

#### Start the Web Client
```sh
cd ../web-client
npm start
```

#### Start the Mobile Client
```sh
cd ../mobile-client
npx expo start
```

### 4. Additional Setup (if needed)
- Ensure `.env` files are correctly configured for each component if required.
- Install `expo-cli` globally for mobile client development:
  ```sh
  npm install -g expo-cli
  ```
- If using an Android emulator, use `10.0.2.2` to connect to localhost.

---

## Contributing
1. Fork the repository.
2. Create a new branch: `git checkout -b feature-branch-name`.
3. Commit your changes: `git commit -m 'Add some feature'`.
4. Push to the branch: `git push origin feature-branch-name`.
5. Open a pull request.

## License
This project is licensed under the MIT License - see the LICENSE file for details.

